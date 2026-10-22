import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createElement, createRef, StrictMode, useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { mountUI } from '@haowei2000/intelligence-ui/runtime';
import { UIRenderer } from '@haowei2000/intelligence-ui/runtime/react';
import { commitDocument, createContract } from '@haowei2000/intelligence-ui/protocol';

const example = async name => JSON.parse(await readFile(new URL(`../protocol/examples/${name}.json`, import.meta.url), 'utf8'));
const committedOf = (candidate, revision = 1, previous) => commitDocument(candidate, { id: 'doc', revision, previous }).committed;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(candidate, options = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://host.example/' });
  const errors = [];
  const ui = mountUI(dom.window.document.querySelector('#app'), { document: committedOf(candidate), debounceMs: 10000, onError: error => errors.push(error), ...options });
  const root = ui.element.shadowRoot;
  const $ = selector => root.querySelector(selector);
  const input = (selector, value) => { const element = $(selector); element.value = value; element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const check = (selector, checked = true) => { const element = $(selector); element.checked = checked; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  const submit = selector => $(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, ui, root, $, input, check, submit, errors, close: () => { ui.destroy(); dom.window.close(); } };
}

test('renders the reference trip card with accessible controls and no Agent markup', async () => {
  const { root, $, close, errors } = setup(await example('trip-plan'));
  assert.deepEqual(errors, []);
  assert.equal($('h3').textContent, 'Plan your weekend');
  assert.equal($('img').getAttribute('alt'), 'Brandenburg Gate at dusk');
  assert.equal($('img').getAttribute('referrerpolicy'), 'no-referrer');
  const link = $('a');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(root.querySelectorAll('fieldset legend').length, 2);
  assert.equal($('input[value=berlin]').checked, true, 'default applied');
  assert.equal($('input[type=range]').value, '600');
  const notes = $('textarea');
  assert.equal(root.querySelector(`label[for="${notes.id}"]`).textContent, 'Anything else?');
  assert.equal($('button[type=submit]').textContent, 'Continue');
  assert.equal(root.querySelectorAll('script, style + style').length, 0);
  close();
});

test('form submission validates locally, then sends only visible in-scope typed values', async () => {
  const events = [];
  const { $, input, check, submit, close } = setup(await example('account-settings'), { onAction: async event => { events.push(event); return { status: 'accepted' }; } });
  submit('form');
  await tick();
  assert.equal(events.length, 0, 'required email blocks submission');
  assert.equal($('input[type=email]').getAttribute('aria-invalid'), 'true');
  assert.match($('.status').textContent, /highlighted/);
  input('input[type=email]', 'not-an-email');
  submit('form'); await tick();
  assert.equal(events.length, 0);
  input('input[type=email]', 'me@example.com');
  input('input[type=number]', '25');
  submit('form'); await tick();
  assert.equal(events.length, 0, 'number above max');
  input('input[type=number]', '3');
  check('input[role=switch]', false);
  assert.equal($('[data-component=day-choice]').hidden, true, 'visibleWhen hides dependent field');
  submit('form'); await tick();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].values, { email: 'me@example.com', digest: false, limit: 3 });
  assert.equal(events[0].actionId, 'save-settings');
  assert.equal(events[0].baseRevision, 1);
  assert.match(events[0].eventId, /^[0-9a-f-]{36}$/);
  assert.match($('.status').textContent, /Received/);
  close();
});

test('pending actions disable buttons, report failure, and reset restores defaults', async () => {
  let release;
  const { $, root, input, submit, close, errors } = setup(await example('account-settings'), { onAction: () => new Promise((_, reject) => { release = reject; }) });
  input('input[type=email]', 'me@example.com');
  submit('form'); await tick();
  assert.equal($('button[type=submit]').disabled, true);
  assert.equal($('form').getAttribute('aria-busy'), 'true');
  submit('form'); await tick();
  release(new Error('backend down')); await tick();
  assert.equal($('button[type=submit]').disabled, false);
  assert.match($('.status').textContent, /failed/);
  assert.equal(errors[0].message, 'backend down');
  [...root.querySelectorAll('button')].find(b => b.textContent === 'Reset').click();
  assert.equal($('input[type=email]').value, '');
  close();
});

test('host action buttons send events without values and accept later status updates', async () => {
  const events = [];
  const { $, ui, close } = setup(await example('hotel-comparison'), { onAction: event => { events.push(event); return { status: 'accepted' }; } });
  [...$('[data-component=hotel-actions]').querySelectorAll('button')][0].click(); await tick();
  assert.deepEqual(events[0].values, {});
  assert.equal(events[0].actionId, 'refresh-prices');
  ui.setActionStatus(events[0].eventId, 'succeeded', 'Prices updated');
  assert.equal($('[data-component=hotel-actions] .status').textContent, 'Prices updated');
  close();
});

test('action status and busy state survive re-renders from new revisions', async () => {
  const v1 = await example('account-settings');
  let finish;
  const events = [];
  const { ui, $, input, submit, close } = setup(v1, { onAction: event => { events.push(event); return new Promise(resolve => { finish = resolve; }); } });
  input('input[type=email]', 'me@example.com');
  submit('form'); await tick();
  const v2 = structuredClone(v1); v2.title = 'Updated';
  ui.apply(committedOf(v2, 2, committedOf(v1)));
  assert.equal($('button[type=submit]').disabled, true, 'still busy after re-render');
  submit('form'); await tick();
  assert.equal(events.length, 1, 'no double submission');
  finish({ status: 'accepted' }); await tick();
  assert.equal($('button[type=submit]').disabled, false);
  assert.match($('.status').textContent, /Received/);
  const v3 = structuredClone(v2); v3.title = 'Third';
  ui.apply(committedOf(v3, 3, committedOf(v2, 2)));
  assert.match($('.status').textContent, /Received/, 'status kept across the Agent follow-up');
  ui.setActionStatus(events[0].eventId, 'succeeded');
  assert.equal($('.status').textContent, 'Done.');
  close();
});

test('tabs use roving focus and arrow keys; disclosure and table sorting stay local', async () => {
  const actions = [];
  const { dom, root, $, close } = setup(await example('hotel-comparison'), { onAction: event => actions.push(event) });
  const tabs = [...root.querySelectorAll('[role=tab]')];
  assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false']);
  assert.deepEqual(tabs.map(t => t.tabIndex), [0, -1]);
  $('[role=tablist]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(root.querySelectorAll('[role=tabpanel]')[0].hidden, true);
  assert.equal(root.activeElement, tabs[1]);
  tabs[0].click();
  const rows = () => [...root.querySelectorAll('tbody tr')].map(tr => tr.firstChild.textContent);
  assert.deepEqual(rows(), ['Hotel Adlon', 'Michelberger', 'Motel One']);
  const priceHeader = [...root.querySelectorAll('th')].find(th => th.textContent.startsWith('Price'));
  priceHeader.querySelector('button').click();
  assert.deepEqual(rows(), ['Motel One', 'Michelberger', 'Hotel Adlon']);
  assert.equal(priceHeader.getAttribute('aria-sort'), 'ascending');
  priceHeader.querySelector('button').click();
  assert.equal(priceHeader.getAttribute('aria-sort'), 'descending');
  const disclosure = $('.disclosure > button');
  assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
  disclosure.click();
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal($('.disclosure > div').hidden, false);
  assert.equal(actions.length, 0, 'local interactions never call the host');
  close();
});

test('URL policy is enforced at render time with usable fallbacks', () => {
  const contract = createContract({ policy: { urls: { image: { origins: ['https://images.example.com'] }, webPreview: { origins: ['https://maps.example.com'] } } } });
  const candidate = { schemaVersion: '1.0', root: { type: 'Stack', id: 's', children: [
    { type: 'Image', id: 'i', src: 'https://images.example.com/a.png', alt: 'A' },
    { type: 'WebPreview', id: 'w', url: 'https://maps.example.com/r', title: 'Map' },
    { type: 'WebPreview', id: 'same', url: 'https://maps.example.com/x', title: 'Map 2' }
  ] } };
  const { root, close } = setup(candidate, { contract });
  const frames = root.querySelectorAll('iframe');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].getAttribute('sandbox'), 'allow-scripts allow-forms allow-popups');
  assert.equal(frames[0].getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(root.querySelector('figcaption a').textContent, /Open original: Map/);
  close();
  // A document committed under a broader contract is refused by a stricter client.
  const blocked = setup({ schemaVersion: '1.0', root: { type: 'Image', id: 'i', src: 'https://other.example/a.png', alt: 'A' } }, { contract });
  assert.match(blocked.root.textContent, /could not be displayed/);
  assert.equal(blocked.errors.length, 1);
  blocked.close();
});

test('previews never get allow-same-origin for the embedding page origin', () => {
  const contract = createContract({ policy: { webPreview: { sandbox: ['allow-scripts', 'allow-same-origin'], hostOrigins: ['https://app.example'] } } });
  const { root, close } = setup({ schemaVersion: '1.0', root: { type: 'WebPreview', id: 'w', url: 'https://host.example/page', title: 'Self' } }, { contract });
  assert.equal(root.querySelector('iframe').getAttribute('sandbox'), 'allow-scripts', 'page origin host.example is stripped of allow-same-origin');
  close();
});

test('apply merges new revisions, keeps dirty input and focus, and reports outcomes', async () => {
  const v1 = await example('trip-plan');
  const merges = [];
  const { ui, root, $, input, check, close } = setup(v1, { onMerge: outcomes => merges.push(outcomes) });
  check('input[value=paris]');
  input('textarea', 'Vegetarian please');
  $('textarea').focus();
  const v2 = structuredClone(v1);
  const choice = v2.root.children[2].children[0];
  choice.options = [{ value: 'berlin', label: 'Berlin' }, { value: 'rome', label: 'Rome' }];
  v2.root.children[2].children[2].default = 900;
  v2.root.title = 'Updated plan';
  const result = ui.apply(committedOf(v2, 2, committedOf(v1)));
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(result.merge, [{ bind: 'destination', outcome: 'value-removed', removed: ['paris'] }]);
  assert.equal(merges.length, 1);
  assert.equal($('h3').textContent, 'Updated plan');
  assert.equal($('textarea').value, 'Vegetarian please');
  assert.equal(root.activeElement, $('textarea'), 'focus restored');
  assert.equal($('input[type=range]').value, '900', 'untouched field follows the new default');
  assert.equal(ui.getState().values.destination, '');
  assert.equal(ui.apply(committedOf(v2, 2)).outcome, 'unchanged');
  assert.equal(ui.apply(committedOf(v1, 1)).outcome, 'stale');
  const different = structuredClone(v2); different.title = 'x';
  assert.equal(ui.apply(committedOf(different, 2)).outcome, 'conflict');
  assert.equal(ui.apply({ ...committedOf(v2, 3), document: { ...v2, schemaVersion: '2.0' } }).outcome, 'unsupported-protocol');
  assert.equal(ui.apply(committedOf({ schemaVersion: '1.0', root: { type: 'Map', id: 'm' } }, 3)).outcome, 'incompatible-capabilities');
  assert.equal(ui.apply(committedOf({ schemaVersion: '1.0', root: { type: 'Text', id: 't' } }, 3)).outcome, 'rejected');
  assert.equal($('h3').textContent, 'Updated plan', 'rejected documents never replace the last valid one');
  close();
});

test('persistence saves serially, rebases pending saves onto new revisions and retries after failure', async () => {
  const v1 = await example('trip-plan');
  const saves = [], statuses = [];
  let fail = true, release;
  const { ui, input, close, errors } = setup(v1, {
    onSaveStatus: status => statuses.push(status),
    onSave: async (state, context) => {
      saves.push({ notes: state.values.notes, revision: context.revision });
      if (saves.length === 2) await new Promise(resolve => { release = resolve; });
      if (fail) { fail = false; throw new Error('offline'); }
    }
  });
  input('textarea', 'first');
  await assert.rejects(ui.flush(), /offline/);
  assert.equal(statuses.at(-1), 'error');
  assert.equal(errors[0].message, 'offline');
  const flushing = ui.flush();
  input('textarea', 'second');
  ui.apply(committedOf(v1, 2, committedOf(v1)));
  release(); await flushing; await ui.flush();
  assert.deepEqual(saves, [{ notes: 'first', revision: 1 }, { notes: 'first', revision: 1 }, { notes: 'second', revision: 2 }]);
  assert.equal(statuses.at(-1), 'saved');
  close();
});

test('read-only mode disables input and actions', async () => {
  const events = [];
  const { ui, root, $, close } = setup(await example('account-settings'), { readOnly: true, onAction: event => events.push(event) });
  assert.ok([...root.querySelectorAll('input,select,button')].every(element => element.disabled));
  ui.update({ readOnly: false });
  assert.equal($('input[type=email]').disabled, false);
  close();
});

test('extension components render through registered trusted renderers only', () => {
  const contract = createContract({ extensions: { 'acme:Badge': { description: 'Badge', props: { label: { schema: { type: 'string' }, required: true, description: 'Text' } } } } });
  const candidate = { schemaVersion: '1.0', root: { type: 'Stack', id: 's', children: [{ type: 'acme:Badge', id: 'b', label: 'New' }] } };
  const withRenderer = setup(candidate, { contract, renderers: { 'acme:Badge': (node, { document }) => { const span = document.createElement('span'); span.className = 'badge'; span.textContent = node.label; return span; } } });
  assert.equal(withRenderer.$('.badge').textContent, 'New');
  withRenderer.close();
  const without = setup(candidate, { contract });
  assert.match(without.root.textContent, /not supported/);
  without.close();
});

test('runtime source has no innerHTML sinks or eval', async () => {
  for (const file of ['../lib/runtime/mount.mjs', '../lib/runtime/connect.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|new Function|\beval\(/, file);
  }
});

test('React UIRenderer is uncontrolled: parent re-renders never reset input and new revisions merge', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://host.example/' });
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const v1 = await example('trip-plan');
  const ref = createRef(), changes = [];
  let setDocument, rerender;
  function App() {
    const [value, setValue] = useState(committedOf(v1));
    const [, setTick] = useState(0);
    setDocument = setValue; rerender = () => setTick(t => t + 1);
    return createElement(UIRenderer, { ref, document: value, debounceMs: 10000, onStateChange: state => changes.push(state), onAction: () => ({ status: 'accepted' }) });
  }
  const root = createRoot(dom.window.document.querySelector('#app'));
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
    const shadow = () => dom.window.document.querySelector('#app').firstChild.firstChild.shadowRoot;
    assert.equal(dom.window.document.querySelector('#app').firstChild.children.length, 1, 'StrictMode leaves one mount');
    const notes = shadow().querySelector('textarea');
    notes.value = 'typed'; notes.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await act(async () => rerender());
    assert.equal(ref.current.getState().values.notes, 'typed');
    const v2 = structuredClone(v1); v2.root.title = 'Revision two';
    await act(async () => setDocument(committedOf(v2, 2, committedOf(v1))));
    assert.equal(shadow().querySelector('h3').textContent, 'Revision two');
    assert.equal(shadow().querySelector('textarea').value, 'typed');
    assert.equal(changes.length, 1);
    await act(async () => root.unmount());
    assert.equal(dom.window.document.querySelector('#app').children.length, 0);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; dom.window.close();
  }
});
