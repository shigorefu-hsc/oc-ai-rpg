import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { App } from './app';
import { MemoryStore } from './store';
import { LocalAI } from './bedrock';
import { config } from './config';
import { serve } from './http';
const store = new MemoryStore('.local/db.json');
await store.load();
const app = new App(store, new LocalAI(), config(true));
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 12000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join('; ') : v);
    const request = new Request('http://' + req.headers.host + req.url, {
      method: req.method,
      headers,
      ...(!['GET', 'HEAD'].includes(req.method ?? 'GET') ? { body: Buffer.concat(chunks) } : {}),
    });
    const result = await serve(app, request, req.socket.remoteAddress ?? 'local', 'dist/client');
    res.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) await pipeline(Readable.fromWeb(result.body as never), res);
    else res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
    console.error('Local request failed', e instanceof Error ? e.name : 'Unknown');
  }
});
server.listen(8787, '127.0.0.1', () =>
  console.log('Local API: http://127.0.0.1:8787 — deterministic fixture, no AWS calls'),
);
