// This is the consuming project's server, not the SDK's standalone studio.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DocumentStore } from '@haowei2000/intelligence-ui/node';
import { initialDocument } from './react/page.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new DocumentStore(path.join(root, '.data', 'embedding-demo'));
const [document] = (await store.list()).length ? await store.list() : [await store.save(initialDocument, 0, true)];
const bundle = await build({ entryPoints: [path.join(root, 'examples', 'react', 'main.jsx')], bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const port = Number(process.env.DEMO_PORT || 4311);
const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  try {
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return send(res, { error: 'Invalid host' }, 403);
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目设置</title><style>body{margin:0;background:#f4f6f8;padding:24px}#root{max-width:800px;margin:auto;background:white;border-radius:12px}</style><div id="root"></div><script src="/app.js" type="module"></script></html>');
    }
    if (req.method === 'GET' && req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle.outputFiles[0].contents); }
    if (req.method === 'GET' && req.url === '/api/page') return send(res, await store.get(document.manifest.id));
    if (req.method === 'PUT' && req.url === `/api/pages/${document.manifest.id}`) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, { error: 'Invalid origin' }, 403);
      let raw = '', bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) return send(res, { error: 'Too large' }, 413); raw += chunk; }
      const data = JSON.parse(raw);
      if (data.document?.manifest.id !== document.manifest.id) return send(res, { error: 'Invalid document ID' }, 400);
      return send(res, await store.save(data.document, data.expectedRevision));
    }
    send(res, { error: 'Not found' }, 404);
  } catch (error) { send(res, { error: error.message }, error.status || 400); }
});
server.listen(port, '127.0.0.1', () => console.log(`Embedding demo: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
