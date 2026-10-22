import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { mountUI } from '@haowei2000/intelligence-ui/runtime';
import { commitDocument, catalog } from '@haowei2000/intelligence-ui/protocol';

const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const examplesDir = new URL('../protocol/examples/', import.meta.url);
const examples = await Promise.all((await readdir(examplesDir)).map(async file => [file, JSON.parse(await readFile(new URL(file, examplesDir), 'utf8'))]));

async function audit(name, candidate, tamper) {
  const dom = new JSDOM('<!doctype html><html lang="en"><head><title>audit</title></head><body><main id="app"></main></body></html>', { url: 'https://host.example/', runScripts: 'outside-only' });
  const ui = mountUI(dom.window.document.querySelector('#app'), { document: commitDocument(candidate, { id: 'a11y', revision: 1 }).committed, onAction: () => ({ status: 'accepted' }) });
  tamper?.(ui.element.shadowRoot, dom.window.document);
  dom.window.eval(axeSource);
  // Color contrast needs real layout, which jsdom does not compute; it is checked in browsers instead.
  const results = await dom.window.axe.run(dom.window.document, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  ui.destroy(); dom.window.close();
  // Copy out of the jsdom realm so assertions compare plain Node arrays.
  return Array.from(results.violations, v => `${v.id}: ${Array.from(v.nodes, n => JSON.stringify(n.target)).join(', ')}`);
}
const clean = async (name, candidate) => assert.deepEqual(await audit(name, candidate), [], name);

test('the audit sees inside the renderer shadow root', async () => {
  const violations = await audit('tampered', { schemaVersion: '1.0', root: { type: 'Text', id: 't', text: 'x' } }, (shadow, document) => {
    const input = document.createElement('input'); shadow.querySelector('.root').append(input);
  });
  assert.ok(violations.some(v => v.startsWith('label:')), violations.join('; '));
});

for (const [file, candidate] of examples) test(`axe finds no violations in ${file}`, () => clean(file, candidate));

test('axe finds no violations in each component example, and every component is covered', async () => {
  const covered = new Set();
  for (const [type, spec] of Object.entries(catalog.components)) {
    const example = structuredClone(spec.example);
    const root = type === 'Button' && example.action?.type !== 'action' ? { type: 'Form', id: 'wrap', submitAction: 'a', children: [example] } : example;
    await clean(type, { schemaVersion: '1.0', root, ...(type === 'Table' ? { datasets: { hotels: { rows: [{ name: 'A', price: 1 }] } } } : {}) });
    covered.add(type);
  }
  for (const [, candidate] of examples) JSON.stringify(candidate, (key, value) => { if (key === 'type' && catalog.components[value]) covered.add(value); return value; });
  assert.deepEqual([...covered].sort(), Object.keys(catalog.components).sort());
});
