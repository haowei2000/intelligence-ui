import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudio, createStudio, createDocument } from 'intelligence-ui';
import { renderDocument } from 'intelligence-ui/document';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('importing the package does not start a server or write to the working directory', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-import-'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const sdk = await import(${JSON.stringify(new URL('../index.mjs', import.meta.url).href)}); console.log(typeof sdk.startStudio)`], { cwd, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
  assert.deepEqual(await readdir(cwd), []);
  assert.match(renderDocument(createDocument(), true), /下载文档/);
});

test('hosts isolate caller workspaces, support port 0, serve packaged assets and shut down', async () => {
  const a = await mkdtemp(path.join(os.tmpdir(), 'studio-a-'));
  const b = await mkdtemp(path.join(os.tmpdir(), 'studio-b-'));
  const first = await startStudio({ workspaceRoot: a, port: 0 });
  const second = await startStudio({ workspaceRoot: b, port: 0, seedDocument: false });
  try {
    assert.notEqual(first.url, second.url);
    assert.equal(first.dataDirectory, path.join(a, '.data', 'documents'));
    assert.equal((await first.store.list()).length, 1);
    assert.equal((await second.store.list()).length, 0);
    const page = await fetch(first.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /document-frame/);
    assert.equal((await fetch(second.url + '/app.js')).status, 200);
    const denied = await new Promise((resolve, reject) => {
      http.get(first.url, { headers: { Host: 'attacker.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(denied, 403);
  } finally { await Promise.all([first.close(), second.close()]); }
});

test('caller AI adapters perform analysis and regeneration while preserving state', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'studio-ai-'));
  let calls = 0;
  const studio = await startStudio({ workspaceRoot, port: 0, ai: { model: 'test-adapter', complete: async messages => {
    calls++;
    assert.equal(messages[0].role, 'system');
    const input = JSON.parse(messages[1].content);
    if (input.prompt) return JSON.stringify({ ...input.document, title: '更新标题' });
    return '调用方模型的分析结果';
  } } });
  try {
    const config = await (await fetch(studio.url + '/api/config')).json();
    let [doc] = await studio.store.list();
    async function post(action, data) {
      const res = await fetch(`${studio.url}/api/documents/${doc.manifest.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Document-Token': config.token }, body: JSON.stringify({ revision: doc.manifest.revision, ...data }) });
      assert.equal(res.status, 200, await res.clone().text());
      doc = await res.json();
    }
    await post('state', { state: { selections: { persistence: 'embedded' }, notes: '选择理由' } });
    await post('analyze', {});
    assert.equal(doc.analysis[0].text, '调用方模型的分析结果');
    assert.equal(doc.analysis[0].model, 'test-adapter');
    await post('regenerate', { prompt: '更新标题' });
    assert.equal(doc.title, '更新标题');
    assert.equal(doc.state.selections.persistence, 'embedded');
    assert.equal(doc.state.notes, '选择理由');
    assert.equal(calls, 2);
  } finally { await studio.close(); }
});

test('CLI help/version are side effect free and invalid arguments fail clearly', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-cli-'));
  const cli = path.join(root, 'bin', 'studio.mjs');
  for (const flag of ['--help', '--version']) {
    const result = spawnSync(process.execPath, [cli, flag], { cwd, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim());
  }
  for (const args of [['--invalid'], ['--port', 'bad'], ['--port', '-1']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /intelligence-ui:/);
  }
  assert.deepEqual(await readdir(cwd), []);
  await assert.rejects(startStudio({ workspaceRoot: cwd, port: -1 }), /port/);
  const unbound = await createStudio({ workspaceRoot: cwd, seedDocument: false });
  assert.equal(unbound.server.listening, false);
});

test('CLI runs through the executable symlink used by npm', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-bin-'));
  const link = path.join(cwd, 'intelligence-ui');
  await symlink(path.join(root, 'bin', 'studio.mjs'), link);
  const result = spawnSync(process.execPath, [link, '--version'], { cwd, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.1.0');
});
