// Scripted OpenAI-compatible model for zero-cost wiring checks.
// Every request body is appended to runs/stub-requests.jsonl so we can see exactly
// what Hermes sent: system prompt (SOUL, skills index, memory), history, tool schemas.
// Policy: on a fresh user message, call the first tool whose name contains STUB_TOOL
// (default "get_contact"); after a tool result, reply with plain text.
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const port = Number(process.env.STUB_PORT ?? 8787);
const wantedTool = process.env.STUB_TOOL ?? 'get_contact';
mkdirSync(new URL('./runs/', import.meta.url), { recursive: true });
const log = new URL('./runs/stub-requests.jsonl', import.meta.url);
let calls = 0;

// Optional per-request override: runs/stub-control.json = {"tool": "memory", "args": {...}}
const control = new URL('./runs/stub-control.json', import.meta.url);

function reply(body) {
  const last = body.messages.at(-1);
  const override = existsSync(control) ? JSON.parse(readFileSync(control, 'utf8')) : null;
  const tool = (body.tools ?? []).find((t) =>
    t.function?.name?.includes(override?.tool ?? wantedTool),
  );
  const args = override?.args ?? { contact_id: 'c1' };
  if (last.role === 'user' && tool) {
    return {
      tool_calls: [
        {
          id: `call_${++calls}`,
          type: 'function',
          function: { name: tool.function.name, arguments: JSON.stringify(args) },
        },
      ],
    };
  }
  const userTurns = body.messages.filter((m) => m.role === 'user').length;
  return { content: `Stub reply #${userTurns}: saw ${body.messages.length} messages.` };
}

function sendStream(res, model, message) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const base = { id: `chatcmpl-${calls}`, object: 'chat.completion.chunk', created: 0, model };
  const delta = message.tool_calls
    ? { role: 'assistant', tool_calls: message.tool_calls.map((c, index) => ({ index, ...c })) }
    : { role: 'assistant', content: message.content };
  const finish = message.tool_calls ? 'tool_calls' : 'stop';
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`,
  );
  res.end('data: [DONE]\n\n');
}

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }),
      );
    }
    if (!req.url.endsWith('/chat/completions')) {
      appendFileSync(log, JSON.stringify({ unhandled: `${req.method} ${req.url}` }) + '\n');
      res.writeHead(404);
      return res.end();
    }
    const body = JSON.parse(raw);
    appendFileSync(log, JSON.stringify(body) + '\n');
    const fault = existsSync(control) ? JSON.parse(readFileSync(control, 'utf8')) : {};
    if (fault.status) {
      res.writeHead(fault.status, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end(
        JSON.stringify({
          error: {
            message: 'Rate limit reached (stub)',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        }),
      );
    }
    if (fault.delay_ms) return setTimeout(() => res.writeHead(200).end('{}'), fault.delay_ms);
    const message = reply(body);
    if (body.stream) return sendStream(res, body.model, message);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', ...message },
            finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    );
  });
}).listen(port, '0.0.0.0', () => console.log(`stub model on :${port}`));
