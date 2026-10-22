import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '@haowei2000/intelligence-ui/node';
import { createDocument, mountDocument, renderDocument } from '@haowei2000/intelligence-ui';

function setup(options = {}) {
  const dom = new JSDOM('<div id="app"></div>');
  const document = createDocument();
  document.ui.html = '<label>名称<input data-field="name"></label><label>数量<input type="number" data-field="count"></label><label><input type="checkbox" data-field="enabled">启用</label><select multiple data-field="tags"><option value="a">A</option><option value="b">B</option></select>';
  const container = dom.window.document.querySelector('#app');
  const controller = mountDocument(container, { document, debounceMs: 10000, ...options });
  return { dom, document, container, controller, root: controller.element.shadowRoot };
}
function edit(dom, element, value) { element.value = value; element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }

test('browser entry bundles without Node modules or a running studio', async () => {
  const result = await build({ entryPoints: ['index.mjs'], bundle: true, platform: 'browser', write: false, metafile: true, format: 'esm' });
  assert.ok(result.outputFiles[0].text.includes('mountDocument'));
  assert.ok(Object.keys(result.metafile.inputs).every(file => !file.includes('host.mjs') && !file.includes('store.mjs')));
  await build({ entryPoints: ['browser/react.mjs'], bundle: true, platform: 'browser', write: false, external: ['react'], format: 'esm' });
});

test('a pure form page needs no decisions and carries its own CSS', () => {
  const document = createDocument({ title: '设置', html: '<select data-field="mode"><option value="one">One</option><option value="two">Two</option></select>', css: 'select{color:red}', state: { selections: {}, notes: '', values: {} } });
  const { dom, controller, root } = setup({ document });
  assert.equal(root.querySelector('[data-notes]'), null);
  assert.equal(root.querySelector('select').value, 'one');
  assert.match(root.querySelector('style').textContent, /select\{color:red\}/);
  assert.deepEqual(controller.getDocument().decisions, []);
  controller.destroy(); dom.window.close();
});

test('renders decisions and typed custom fields, emits snapshots without mutating caller data', () => {
  const changes = [];
  const { dom, document, controller, root } = setup({ onChange: (next, context) => changes.push({ next, context }) });
  root.querySelector('[data-decision="persistence"][data-option="embedded"]').click();
  edit(dom, root.querySelector('[data-notes]'), '选择理由');
  edit(dom, root.querySelector('[data-field="name"]'), '项目 A');
  edit(dom, root.querySelector('[data-field="count"]'), '3');
  const checkbox = root.querySelector('[data-field="enabled"]'); checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const select = root.querySelector('[data-field="tags"]'); select.options[1].selected = true; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(controller.getDocument().state, { selections: { persistence: 'embedded' }, notes: '选择理由', values: { name: '项目 A', count: 3, enabled: true, tags: ['b'] } });
  assert.deepEqual(document.state, { selections: {}, notes: '' });
  assert.equal(changes.at(-1).context.field, 'tags');
  changes[0].next.title = '外部修改快照';
  assert.notEqual(controller.getDocument().title, '外部修改快照');
  controller.destroy(); dom.window.close();
});

test('serial saves use updated revisions and never overwrite edits made during a write', async () => {
  const calls = [];
  let resolveFirst;
  const firstSaved = new Promise(resolve => resolveFirst = resolve);
  const { dom, controller, root } = setup({ onSave: async (doc, context) => {
    calls.push({ doc, context });
    if (calls.length === 1) await firstSaved;
    return { ...doc, manifest: { ...doc.manifest, revision: doc.manifest.revision + 1 } };
  } });
  edit(dom, root.querySelector('[data-notes]'), '第一次');
  const flushing = controller.flush();
  edit(dom, root.querySelector('[data-notes]'), '第二次');
  resolveFirst(); await flushing;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].doc.state.notes, '第一次');
  assert.equal(calls[1].doc.state.notes, '第二次');
  assert.equal(calls[1].context.baseRevision, 1);
  assert.equal(controller.getDocument().manifest.revision, 2);
  assert.equal(controller.getDocument().state.notes, '第二次');
  controller.destroy(); dom.window.close();
});

test('save failure preserves changes and allows explicit retry', async () => {
  let attempts = 0;
  const errors = [], statuses = [];
  const { dom, controller, root } = setup({ onError: e => errors.push(e), onSaveStatus: s => statuses.push(s), onSave: async doc => {
    if (++attempts === 1) throw new Error('服务端拒绝');
    return doc;
  } });
  edit(dom, root.querySelector('[data-field="name"]'), '保留');
  await assert.rejects(controller.flush(), /服务端拒绝/);
  assert.equal(controller.getDocument().state.values.name, '保留');
  await controller.flush();
  assert.equal(attempts, 2); assert.equal(errors.length, 1);
  assert.ok(statuses.includes('error')); assert.equal(statuses.at(-1), 'saved');
  controller.destroy(); dom.window.close();
});

test('external updates hydrate controls, keep focus and do not trigger write-back', async () => {
  let changes = 0, saves = 0;
  const { dom, controller, root } = setup({ onChange: () => changes++, onSave: () => saves++ });
  const notes = root.querySelector('[data-notes]'); notes.focus();
  const doc = controller.getDocument(); doc.state.notes = '外部数据'; doc.state.values = { name: '外部名称', enabled: true };
  controller.update(doc);
  assert.equal(root.querySelector('[data-notes]'), notes);
  assert.equal(root.activeElement, notes);
  assert.equal(notes.value, '外部数据');
  assert.equal(root.querySelector('[data-field="name"]').value, '外部名称');
  assert.equal(root.querySelector('[data-field="enabled"]').checked, true);
  await controller.flush(); assert.equal(changes, 0); assert.equal(saves, 0);
  controller.update(doc, { readOnly: true });
  root.querySelector('[data-option="embedded"]').click();
  assert.equal(changes, 0); assert.ok(root.querySelector('[data-field="name"]').disabled);
  controller.destroy(); dom.window.close();
});

test('document replacement cancels old saves and ignores late results', async () => {
  let finish, signal;
  const { dom, controller, root } = setup({ onSave: (doc, context) => { signal = context.signal; return new Promise(resolve => finish = () => resolve(doc)); } });
  edit(dom, root.querySelector('[data-notes]'), '旧文档');
  const flushing = controller.flush();
  const next = createDocument('新文档'); controller.update(next);
  assert.ok(signal.aborted);
  finish(); await flushing;
  assert.equal(controller.getDocument().title, '新文档');
  controller.destroy(); dom.window.close();
});

test('custom HTML cannot execute scripts or impersonate built-in controls', () => {
  const document = createDocument();
  document.ui.html = '<script>globalThis.hacked=true</script><iframe src="https://example.com"></iframe><img src=x onerror="bad()"><input data-field="name" onclick="bad()"><button data-decision="persistence" data-option="embedded">自定义</button>';
  const { dom, controller, root } = setup({ document });
  assert.equal(root.querySelector('script,iframe,img,[onclick]'), null);
  assert.equal(root.querySelector('section button').hasAttribute('data-decision'), false);
  assert.equal(root.querySelectorAll('[data-decision]').length, 6);
  controller.destroy(); dom.window.close();
});

test('portable HTML hydrates and writes custom field values into document data', () => {
  const document = createDocument(); document.ui.html = '<input data-field="name"><input type="checkbox" data-field="enabled">';
  document.state.values = { name: '已保存', enabled: true };
  const dom = new JSDOM(renderDocument(document, true), { runScripts: 'dangerously' });
  const field = dom.window.document.querySelector('[data-field="name"]');
  assert.equal(field.value, '已保存');
  assert.ok(dom.window.document.querySelector('[data-field="enabled"]').checked);
  edit(dom, field, '更新值');
  const embedded = JSON.parse(dom.window.document.querySelector('#intelligence-document').textContent);
  assert.equal(embedded.state.values.name, '更新值');
  dom.window.close();
});

test('embedded fields write through a caller HTTP API to disk and hydrate after remount', async () => {
  const store = new DocumentStore(await mkdtemp(path.join(os.tmpdir(), 'embedded-writeback-')));
  const document = await store.save(createDocument({ title: '设置', html: '<input data-field="name">', state: { selections: {}, notes: '', values: { name: '初始' } } }), 0, true);
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    try {
      const data = JSON.parse(raw);
      const saved = await store.save(data.document, data.expectedRevision);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(saved));
    } catch (error) { res.writeHead(409); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const first = setup({ document, onSave: async (next, { signal, baseRevision }) => {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: next, expectedRevision: baseRevision }), signal });
    if (!res.ok) throw new Error('版本冲突'); return res.json();
  } });
  try {
    edit(first.dom, first.root.querySelector('[data-field="name"]'), '写回数据库接口');
    await first.controller.flush(); first.controller.destroy();
    const fromDisk = await store.get(document.manifest.id);
    assert.equal(fromDisk.manifest.revision, 2);
    const second = setup({ document: fromDisk });
    assert.equal(second.root.querySelector('[data-field="name"]').value, '写回数据库接口');
    second.controller.destroy(); second.dom.window.close();
  } finally { first.controller.destroy(); first.dom.window.close(); await new Promise(resolve => server.close(resolve)); }
});

test('custom CSS that references external resources is not applied', () => {
  const errors = [];
  for (const css of ['@import url(https://x.test/a.css)', 'input[value^=a]{background:u\\72l(https://x.test/?a)}', 'b{background:image-set("https://x.test/i.png" 1x)}']) {
    const document = createDocument({ title: 'CSS', css });
    const { dom, controller, root } = setup({ document, onError: error => errors.push(error) });
    assert.doesNotMatch(root.querySelector('style').textContent, /x\.test/);
    controller.destroy(); dom.window.close();
  }
  assert.equal(errors.length, 3);
});

test('createDocument works without crypto.randomUUID (insecure contexts)', () => {
  const original = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try { assert.match(createDocument().manifest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }
  finally { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true, writable: true }); }
});

test('clearing notes in a document without decisions keeps the textarea', () => {
  const document = createDocument({ title: '备注', state: { selections: {}, notes: 'x' } });
  const { dom, controller, root } = setup({ document });
  const notes = root.querySelector('[data-notes]');
  edit(dom, notes, '');
  controller.update(controller.getDocument());
  assert.equal(root.querySelector('[data-notes]'), notes);
  controller.destroy(); dom.window.close();
});

test('edits made before onSave is supplied are saved once it arrives', async () => {
  const writes = [];
  const { dom, controller, root } = setup();
  edit(dom, root.querySelector('[data-notes]'), '早期');
  controller.update(undefined, { onSave: async doc => { writes.push(doc); } });
  await controller.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].state.notes, '早期');
  controller.destroy(); dom.window.close();
});
