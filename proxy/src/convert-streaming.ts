/**
 * OpenAI SSE streaming → Anthropic SSE streaming conversion
 *
 * Converts OpenAI chat.completion.chunk events to Anthropic
 * content_block_start / content_block_delta / message_delta events.
 */

import type { ServerResponse } from 'http';

interface OpenAIDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  } | null;
}

function sendSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Handle streaming: read OpenAI SSE, convert to Anthropic SSE.
 */
export async function handleStreaming(
  upstream: Response,
  res: ServerResponse,
  requestModel: string,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send message_start event
  const messageId = `msg_${Date.now()}`;
  sendSSE(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: requestModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  // Track state for content blocks
  let contentBlockIndex = 0;
  let textBlockStarted = false;
  // Track active tool call blocks: openai index → our block index
  const toolCallBlocks = new Map<number, { blockIndex: number; id: string; name: string }>();
  let inputTokens = 0;
  let outputTokens = 0;

  const body = upstream.body;
  if (!body) {
    sendSSE(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 0 },
    });
    sendSSE(res, 'message_stop', { type: 'message_stop' });
    res.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        // Track usage from stream_options
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Reasoning content delta — stream as regular text since Claude SDK
        // rejects thinking blocks unless extended thinking is explicitly enabled.
        // When actual content arrives later, it continues in the same text block.
        if (delta.reasoning_content) {
          if (!textBlockStarted) {
            sendSSE(res, 'content_block_start', {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            });
            textBlockStarted = true;
          }
          // Skip reasoning content — only forward the final answer.
          // Reasoning adds latency and noise for the end user.
        }

        // Text content delta
        if (delta.content) {
          if (!textBlockStarted) {
            sendSSE(res, 'content_block_start', {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            });
            textBlockStarted = true;
          }

          sendSSE(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          });
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallBlocks.get(tc.index);

            if (!existing && tc.id && tc.function?.name) {
              // Close text block if open
              if (textBlockStarted) {
                sendSSE(res, 'content_block_stop', {
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                });
                contentBlockIndex++;
                textBlockStarted = false;
              }

              // Start new tool_use block
              const blockIdx = contentBlockIndex;
              contentBlockIndex++;
              toolCallBlocks.set(tc.index, {
                blockIndex: blockIdx,
                id: tc.id,
                name: tc.function.name,
              });

              sendSSE(res, 'content_block_start', {
                type: 'content_block_start',
                index: blockIdx,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                },
              });
            }

            // Stream partial JSON arguments
            if (tc.function?.arguments) {
              const block = toolCallBlocks.get(tc.index);
              if (block) {
                sendSSE(res, 'content_block_delta', {
                  type: 'content_block_delta',
                  index: block.blockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                });
              }
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          // Close any open blocks
          if (textBlockStarted) {
            sendSSE(res, 'content_block_stop', {
              type: 'content_block_stop',
              index: contentBlockIndex,
            });
          }

          for (const [, block] of toolCallBlocks) {
            sendSSE(res, 'content_block_stop', {
              type: 'content_block_stop',
              index: block.blockIndex,
            });
          }

          const stopReason =
            choice.finish_reason === 'tool_calls' ? 'tool_use' :
            choice.finish_reason === 'length' ? 'max_tokens' :
            'end_turn';

          sendSSE(res, 'message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stopReason },
            usage: { output_tokens: outputTokens },
          });
        }
      }
    }
  } catch (err) {
    console.error('[proxy] Streaming error:', err);
  }

  sendSSE(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
