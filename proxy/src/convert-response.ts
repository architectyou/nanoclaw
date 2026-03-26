/**
 * OpenAI Chat Completion → Anthropic Messages API response conversion
 */

interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface OpenAIResponse {
  id: string;
  choices: OpenAIChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

function mapStopReason(finishReason: string): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/**
 * Convert an OpenAI Chat Completion response to Anthropic Messages API format.
 */
export function convertResponse(
  openai: OpenAIResponse,
  requestModel: string,
): AnthropicResponse {
  const choice = openai.choices[0];
  const content: AnthropicContentBlock[] = [];

  // GLM models may return reasoning_content (chain-of-thought).
  // The Claude SDK doesn't expect thinking blocks unless extended thinking is enabled,
  // so we skip reasoning_content and only return the final answer.
  // If the model only produced reasoning (content is empty), include reasoning as text.
  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    });
  } else if (choice.message.reasoning_content) {
    content.push({
      type: 'text',
      text: choice.message.reasoning_content,
    });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = tc.function.arguments;
      }

      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content at all, add empty text block
  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: `msg_${openai.id}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: mapStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openai.usage?.prompt_tokens ?? 0,
      output_tokens: openai.usage?.completion_tokens ?? 0,
    },
  };
}
