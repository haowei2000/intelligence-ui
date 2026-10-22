#!/usr/bin/env node
// Serves the demo frontend on its own origin with a strict CSP (no inline scripts, nonce-only styles).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAssetHandler } from '@haowei2000/intelligence-ui/node';

const port = Number(process.env.PORT || 4331);
const service = process.env.IUI_SERVICE || 'http://127.0.0.1:4320';
const assets = createAssetHandler();
const files = { '/app.mjs': ['app.mjs', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };

export function createFrontend({ serviceUrl = service, surface = 'demo', userToken = 'demo-user-token-change-me' } = {}) {
  return http.createServer(async (request, response) => {
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src https: data:; frame-src https:; connect-src 'self' ${serviceUrl}; base-uri 'none'; frame-ancestors 'none'`);
    if (request.url === '/config.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ service: serviceUrl, surface, userToken }));
    }
    if (request.url === '/') {
      // The nonce must come from the same response as the CSP header, so it is written into the page.
      const page = (await readFile(new URL('index.html', import.meta.url), 'utf8')).replace('</head>', `  <meta name="style-nonce" content="${nonce}">\n</head>`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(page);
    }
    if (await assets(request, response)) return;
    const file = files[request.url.split('?')[0]];
    if (!file) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
    response.end(await readFile(new URL(file[0], import.meta.url)));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createFrontend().listen(port, '127.0.0.1', () => console.log(`Frontend: http://localhost:${port} (service ${service})`));
}
