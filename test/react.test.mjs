import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createElement, createRef, StrictMode, useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { DocumentRenderer } from '@haowei2000/intelligence-ui/react';
import { createDocument } from '@haowei2000/intelligence-ui';

test('React controlled rendering survives StrictMode, saves through caller and cleans up', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const ref = createRef(), changes = [], writes = [];
  const initial = createDocument();
  function App() {
    const [value, setValue] = useState(initial);
    return createElement(DocumentRenderer, { ref, value, debounceMs: 10000, onChange: next => { changes.push(next); setValue(next); }, onSave: async next => {
      writes.push(next); return { ...next, manifest: { ...next.manifest, revision: next.manifest.revision + 1 } };
    } });
  }
  const root = createRoot(dom.window.document.querySelector('#app'));
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
    assert.equal(dom.window.document.querySelector('#app').firstChild.children.length, 1);
    const embedded = dom.window.document.querySelector('#app').firstChild.firstChild.shadowRoot;
    await act(async () => embedded.querySelector('[data-option="embedded"]').click());
    assert.equal(changes.length, 1);
    assert.equal(ref.current.getDocument().state.selections.persistence, 'embedded');
    await act(async () => ref.current.flush());
    assert.equal(writes.length, 1);
    assert.equal(ref.current.getDocument().manifest.revision, 1);
    assert.ok(embedded.querySelector('[data-option="embedded"]').getAttribute('aria-pressed') === 'true');
    await act(async () => root.unmount());
    assert.equal(dom.window.document.querySelector('#app').children.length, 0);
  } finally {
    globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.window.close();
  }
  const ssr = renderToString(createElement(DocumentRenderer, { value: initial }));
  assert.equal(ssr, '<div></div>');
});

test('uncontrolled React use keeps edits across parent re-renders with a new onSave', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const ref = createRef(), initial = createDocument();
  let rerender;
  function App() {
    const [tick, setTick] = useState(0); rerender = () => setTick(tick + 1);
    return createElement(DocumentRenderer, { ref, value: initial, debounceMs: 10000, onSave: async () => {} });
  }
  const root = createRoot(dom.window.document.querySelector('#app'));
  try {
    await act(async () => root.render(createElement(App)));
    const embedded = dom.window.document.querySelector('#app').firstChild.firstChild.shadowRoot;
    await act(async () => embedded.querySelector('[data-option="embedded"]').click());
    await act(async () => rerender());
    assert.equal(ref.current.getDocument().state.selections.persistence, 'embedded');
    await act(async () => root.unmount());
  } finally {
    globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.window.close();
  }
});
