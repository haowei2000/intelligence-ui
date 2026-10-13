import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDocument, mergeDocument, renderDocument, validateDocument } from '../lib/document.mjs';
import { DocumentStore, readReference } from '../lib/store.mjs';

test('state survives save, reload and portable HTML export', async () => {
  const store = new DocumentStore(await mkdtemp(path.join(os.tmpdir(), 'document-store-')));
  let doc = await store.save(createDocument(), 0, true);
  doc.state = { selections: { persistence: 'embedded' }, notes: '保留选择 <script> & 备注' };
  doc = await store.save(doc, 1);
  const loaded = await store.get(doc.manifest.id);
  assert.deepEqual(loaded.state, doc.state);
  const html = renderDocument(loaded, true);
  const data = JSON.parse(html.match(/<script id="intelligence-document" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data.state, loaded.state);
  assert.ok(html.includes('sandbox') === false);
  assert.ok(html.includes("connect-src 'none'"));
  const backup = JSON.parse(await readFile(`${store.file(doc.manifest.id)}.backup`, 'utf8'));
  assert.equal(backup.manifest.revision, 1);
});

test('concurrent writers cannot silently overwrite a revision', async () => {
  const store = new DocumentStore(await mkdtemp(path.join(os.tmpdir(), 'document-conflict-')));
  const doc = await store.save(createDocument(), 0, true);
  const results = await Promise.allSettled([store.save(structuredClone(doc), 1), store.save(structuredClone(doc), 1)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await store.get(doc.manifest.id)).manifest.revision, 2);
});

test('regeneration retains valid IDs and archives deleted selections', () => {
  const current = createDocument(); current.state.selections = { persistence: 'embedded', references: 'hash' }; current.state.notes = '保留备注';
  const next = structuredClone(current); next.decisions = next.decisions.filter(d => d.id !== 'references');
  const merged = mergeDocument(current, next);
  assert.deepEqual(merged.state.selections, { persistence: 'embedded' });
  assert.equal(merged.state.notes, '保留备注');
  assert.equal(merged.archivedSelections[0].decisionId, 'references');
});

test('invalid IDs and selections are rejected', () => {
  const doc = createDocument(); doc.state.selections.persistence = 'does-not-exist';
  assert.throws(() => validateDocument(doc), /失效/);
  doc.state.selections = {}; doc.decisions.push(doc.decisions[0]);
  assert.throws(() => validateDocument(doc), /ID/);
});

test('references detect changes and reject traversal, secrets and escaping symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'document-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'document-outside-'));
  await writeFile(path.join(root, 'code.js'), 'function first() {}\n');
  const first = await readReference(root, 'code.js');
  await writeFile(path.join(root, 'code.js'), 'function changed() {}\n');
  assert.notEqual((await readReference(root, 'code.js')).hash, first.hash);
  await writeFile(path.join(outside, 'secret.js'), 'secret');
  await symlink(path.join(outside, 'secret.js'), path.join(root, 'escape.js'));
  for (const file of ['../secret.js', '/etc/passwd', '.env', 'node_modules/code.js', 'escape.js']) await assert.rejects(readReference(root, file));
  await assert.rejects(readReference(root, 'code.js', 5, 10), /起始行/);
  await assert.rejects(readReference(root, 'code.js', 1, 1000), /范围/);
});
