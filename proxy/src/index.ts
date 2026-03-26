/**
 * NanoClaw GLM Proxy
 *
 * Translates Anthropic Messages API requests into OpenAI Chat Completion
 * format, forwards them to GLM-5 (ZhipuAI), and converts responses back
 * to Anthropic format. Supports both streaming and non-streaming modes.
 *
 * Usage:
 *   ZHIPU_API_KEY=xxx ZHIPU_MODEL=glm-5 GLM_PROXY_PORT=4000 npx tsx src/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { convertRequest } from './convert-request.js';
import { convertResponse } from './convert-response.js';
import { handleStreaming } from './convert-streaming.js';

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const ZHIPU_BASE_URL =
  process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4';
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || 'glm-5';
const PORT = parseInt(process.env.GLM_PROXY_PORT || '4000', 10);

if (!ZHIPU_API_KEY) {
  console.error('ZHIPU_API_KEY environment variable is required');
  process.exit(1);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, {
    type: 'error',
    error: { type: 'api_error', message },
  });
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const raw = await readBody(req);
  let anthropicReq: Record<string, unknown>;
  try {
    anthropicReq = JSON.parse(raw);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  const openaiReq = convertRequest(anthropicReq, ZHIPU_MODEL);
  const isStreaming = anthropicReq.stream === true;

  const openaiBody = JSON.stringify(openaiReq);

  const url = `${ZHIPU_BASE_URL}/chat/completions`;

  console.log(
    `[proxy] ${isStreaming ? 'stream' : 'sync'} request → ${ZHIPU_MODEL}`,
  );

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ZHIPU_API_KEY}`,
    },
    body: openaiBody,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error(`[proxy] GLM error ${upstream.status}: ${errText}`);
    sendError(
      res,
      upstream.status,
      `GLM API error: ${errText.slice(0, 500)}`,
    );
    return;
  }

  if (isStreaming) {
    await handleStreaming(
      upstream,
      res,
      anthropicReq.model as string,
    );
  } else {
    const openaiRes = (await upstream.json()) as Record<string, unknown>;
    const anthropicRes = convertResponse(
      openaiRes as never,
      anthropicReq.model as string,
    );
    sendJson(res, 200, anthropicRes);
  }
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-api-key, anthropic-version',
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // POST /v1/messages — main endpoint
    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      await handleMessages(req, res);
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', model: ZHIPU_MODEL });
      return;
    }

    sendError(res, 404, `Not found: ${req.method} ${req.url}`);
  } catch (err) {
    console.error('[proxy] Unhandled error:', err);
    sendError(
      res,
      500,
      err instanceof Error ? err.message : 'Internal proxy error',
    );
  }
});

server.listen(PORT, () => {
  console.log(`[proxy] GLM proxy listening on http://localhost:${PORT}`);
  console.log(`[proxy] Model: ${ZHIPU_MODEL}`);
  console.log(`[proxy] GLM base URL: ${ZHIPU_BASE_URL}`);
});
