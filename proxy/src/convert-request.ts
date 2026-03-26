/**
 * Anthropic Messages API → OpenAI Chat Completion request conversion
 */

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

/**
 * Convert a single Anthropic message to one or more OpenAI messages.
 */
function convertMessage(msg: AnthropicMessage): OpenAIMessage[] {
  // Simple string content
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  if (!Array.isArray(msg.content)) {
    return [{ role: msg.role, content: String(msg.content) }];
  }

  // Assistant message with tool_use blocks
  if (msg.role === 'assistant') {
    const textParts = msg.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!);
    const toolUses = msg.content.filter((b) => b.type === 'tool_use');

    const result: OpenAIMessage = {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('') : null,
    };

    if (toolUses.length > 0) {
      result.tool_calls = toolUses.map((tu) => ({
        id: tu.id!,
        type: 'function' as const,
        function: {
          name: tu.name!,
          arguments:
            typeof tu.input === 'string'
              ? tu.input
              : JSON.stringify(tu.input),
        },
      }));
    }

    return [result];
  }

  // User message: may contain text blocks and/or tool_result blocks
  if (msg.role === 'user') {
    const toolResults = msg.content.filter((b) => b.type === 'tool_result');
    const textBlocks = msg.content.filter(
      (b) => b.type === 'text' || b.type === undefined,
    );

    const results: OpenAIMessage[] = [];

    // tool_result blocks → role: "tool" messages
    for (const tr of toolResults) {
      let content: string;
      if (typeof tr.content === 'string') {
        content = tr.content;
      } else if (Array.isArray(tr.content)) {
        content = tr.content
          .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('');
      } else {
        content = tr.content ? JSON.stringify(tr.content) : '';
      }

      // Prepend error indicator if the tool result is an error
      if (tr.is_error) {
        content = `[ERROR] ${content}`;
      }

      results.push({
        role: 'tool',
        content,
        tool_call_id: tr.tool_use_id!,
      });
    }

    // Text blocks → regular user message
    if (textBlocks.length > 0) {
      const text = textBlocks
        .map((b) => b.text || '')
        .join('');
      if (text) {
        results.push({ role: 'user', content: text });
      }
    }

    // If only tool results, just return those
    if (results.length > 0) {
      return results;
    }

    // Fallback: join all content as text
    const fallbackText = msg.content
      .map((b) => b.text || JSON.stringify(b))
      .join('');
    return [{ role: 'user', content: fallbackText }];
  }

  // Other roles
  const text = msg.content
    .map((b) => b.text || '')
    .join('');
  return [{ role: msg.role, content: text }];
}

/**
 * Convert Anthropic tool definitions to OpenAI format.
 */
function convertTools(
  tools: Array<{
    name: string;
    description?: string;
    input_schema?: unknown;
  }>,
): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Convert an Anthropic Messages API request body to OpenAI Chat Completion format.
 */
export function convertRequest(
  anthropic: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const messages: OpenAIMessage[] = [];

  // Anthropic system → OpenAI system message
  if (anthropic.system) {
    if (typeof anthropic.system === 'string') {
      messages.push({ role: 'system', content: anthropic.system });
    } else if (Array.isArray(anthropic.system)) {
      // system can be array of content blocks
      const text = (anthropic.system as AnthropicContentBlock[])
        .map((b) => b.text || '')
        .join('\n');
      messages.push({ role: 'system', content: text });
    }
  }

  // Convert messages
  const anthropicMessages = (anthropic.messages || []) as AnthropicMessage[];
  for (const msg of anthropicMessages) {
    messages.push(...convertMessage(msg));
  }

  const result: Record<string, unknown> = {
    model,
    messages,
  };

  // max_tokens
  if (anthropic.max_tokens != null) {
    result.max_tokens = anthropic.max_tokens;
  }

  // temperature
  if (anthropic.temperature != null) {
    result.temperature = anthropic.temperature;
  }

  // top_p
  if (anthropic.top_p != null) {
    result.top_p = anthropic.top_p;
  }

  // stop_sequences → stop
  if (anthropic.stop_sequences) {
    result.stop = anthropic.stop_sequences;
  }

  // stream
  if (anthropic.stream === true) {
    result.stream = true;
    result.stream_options = { include_usage: true };
  }

  // tools
  if (Array.isArray(anthropic.tools) && anthropic.tools.length > 0) {
    result.tools = convertTools(
      anthropic.tools as Array<{
        name: string;
        description?: string;
        input_schema?: unknown;
      }>,
    );
  }

  // tool_choice
  if (anthropic.tool_choice) {
    const tc = anthropic.tool_choice as Record<string, unknown>;
    if (tc.type === 'auto') {
      result.tool_choice = 'auto';
    } else if (tc.type === 'any') {
      result.tool_choice = 'required';
    } else if (tc.type === 'tool' && tc.name) {
      result.tool_choice = {
        type: 'function',
        function: { name: tc.name },
      };
    }
  }

  return result;
}
