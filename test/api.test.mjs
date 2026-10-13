import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 15000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
let child, config;
before(async () => {
  child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DOCUMENT_DATA_DIR: await mkdtemp(path.join(os.tmpdir(), 'document-api-')), WORKSPACE_ROOT: root, AI_BASE_URL: '', AI_MODEL: '', AI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    child.stdout.on('data', data => { if (data.toString().includes('Document Studio:')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exit ${code}`)); });
  });
  config = await (await fetch(`${base}/api/config`)).json();
});
after(() => child?.kill());
async function post(route, data, token = config.token) {
  return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Document-Token': token }, body: JSON.stringify(data) });
}

test('API persists state, produces real reference checks, and exports/imports portable data', async () => {
  let doc = await (await post('/api/documents', { title: '集成验证', description: '真实保存流程' })).json();
  const url = `/api/documents/${doc.manifest.id}`;
  doc = await (await post(url + '/state', { revision: doc.manifest.revision, state: { selections: { persistence: 'embedded' }, notes: '集成测试备注' } })).json();
  let response = await post(url + '/state', { revision: 1, state: doc.state });
  assert.equal(response.status, 409);
  doc = await (await post(url + '/reference', { revision: doc.manifest.revision, decisionId: 'persistence', path: 'lib/store.mjs', startLine: 1, endLine: 30 })).json();
  doc = await (await post(url + '/analyze', { revision: doc.manifest.revision })).json();
  assert.equal(doc.analysis[0].kind, 'local');
  assert.equal(doc.analysis[0].references.length, 1);
  assert.match(doc.analysis[0].text, /lib\/store.mjs/);
  const loaded = await (await fetch(base + url)).json();
  assert.equal(loaded.state.notes, '集成测试备注');
  const html = await (await fetch(base + url + '/export')).text();
  const exported = JSON.parse(html.match(/<script id="intelligence-document" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  response = await post('/api/documents', { document: exported });
  assert.equal(response.status, 201);
  const imported = await response.json();
  assert.notEqual(imported.manifest.id, loaded.manifest.id);
  assert.deepEqual(imported.state, loaded.state);
});

test('host rejects unauthorized writes, invalid import and out-of-workspace reads', async () => {
  assert.equal((await post('/api/documents', { title: 'unauthorized' }, 'invalid')).status, 403);
  assert.equal((await post('/api/documents', { document: { manifest: { id: '../bad' } } })).status, 400);
  assert.equal((await fetch(base + '/api/reference?path=../outside.js')).status, 400);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
