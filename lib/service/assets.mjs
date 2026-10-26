import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED = [/^runtime\.mjs$/, /^protocol\.mjs$/, /^agent\.mjs$/, /^lib\/protocol\/[a-z-]+\.mjs$/, /^lib\/runtime\/(mount|connect|styles|chart)\.mjs$/, /^playground\/[a-z-]+\.(html|mjs|css)$/, /^protocol\/[a-z.-]+\.(json|md)$/, /^protocol\/(examples|conformance)\/[a-z0-9-]+\.json$/];
const TYPES = { '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

/**
 * Serves the package's browser modules (runtime, protocol, playground) without a bundler.
 * Only an allow list of files is reachable; nothing outside the package is served.
 */
export function createAssetHandler({ prefix = '/assets/', csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: data:; frame-src https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } = {}) {
  return async function handle(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const url = new URL(request.url, 'http://assets');
    if (!url.pathname.startsWith(prefix)) return false;
    let relative = decodeURIComponent(url.pathname.slice(prefix.length));
    if (relative === 'playground') { response.writeHead(301, { Location: `${prefix}playground/` }); response.end(); return true; }
    if (relative === 'playground/') relative = 'playground/index.html';
    if (!ALLOWED.some(pattern => pattern.test(relative)) || relative.includes('..')) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); return true; }
    try {
      const content = await readFile(path.join(packageRoot, relative));
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(relative)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...(relative.endsWith('.html') ? { 'Content-Security-Policy': csp } : {}) });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
    return true;
  };
}
