import * as validators from '../protocol/validators.mjs';
import { validate } from '../protocol/validate.mjs';
import { standardContract, canonicalJSON } from '../protocol/contract.mjs';
import { checkUrl, sandboxFor } from '../protocol/url.mjs';
import { fieldsOf, initialState, mergeState, checkField, isVisible, formFields, defaultValue } from '../protocol/state.mjs';
import { styles } from './styles.mjs';
import { renderChart } from './chart.mjs';

export const defaultLabels = Object.freeze({
  submitting: 'Sending…', accepted: 'Received. Waiting for a response…', succeeded: 'Done.', failed: 'The action failed. Try again.',
  invalid: 'Check the highlighted fields.', openOriginal: 'Open original', imageUnavailable: 'Image unavailable', linkBlocked: 'Link not allowed',
  previewBlocked: 'This page cannot be previewed here.', previewHint: 'If the preview stays empty, the site may not allow embedding.', empty: 'No data.',
  unsupported: 'This content is not supported here.', invalidDocument: 'This content could not be displayed.', choose: 'Choose…',
  required: 'Required.', invalidEmail: 'Enter a valid email address.', invalidUrl: 'Enter a valid http or https URL.', invalidDate: 'Use YYYY-MM-DD.', invalidTime: 'Use HH:MM.',
  tooShort: 'Enter at least {limit} characters.', tooLong: 'Enter at most {limit} characters.', tooSmall: 'Enter {limit} or more.', tooLarge: 'Enter {limit} or less.',
  selectAtLeast: 'Select at least {limit}.', selectAtMost: 'Select at most {limit}.', invalid_value: 'Enter a valid value.', chartData: 'View chart data'
});

let instances = 0;
// crypto.randomUUID needs a secure context; getRandomValues does not.
function uuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Renders a committed component document into a Shadow DOM. The renderer owns editable state:
 * hosts pass committed documents with apply() and receive changes through callbacks.
 */
export function mountUI(container, initialOptions) {
  if (!container?.ownerDocument || typeof container.append !== 'function') throw new TypeError('container must be a DOM element');
  let options = { debounceMs: 300, readOnly: false, ...initialOptions };
  checkSettings(options);
  const contract = options.contract || standardContract();
  const doc = container.ownerDocument, win = doc.defaultView;
  const labels = { ...defaultLabels, ...options.labels };
  const prefix = `iui${++instances}`;
  let committed, state, destroyed = false, pending = false, timer, saving, activeSave, changeId = 0, epoch = 0;
  let fields = new Map(), controls = new Map(), visibility = [], actionScopes = new Map(), actionControllers = new Set();
  // Action feedback is keyed by form or button id so it survives re-renders from new revisions.
  const actionStatus = new Map(), busyKeys = new Set(), eventKeys = new Map();
  const view = { tabs: new Map(), open: new Map(), sort: new Map() };
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  container.append(host);

  const report = error => { if (!destroyed) try { options.onError?.(error); } catch { /* host error handlers must not break rendering */ } };
  const notify = (callback, ...args) => { if (!destroyed && callback) try { callback(...args); } catch (error) { report(error); } };
  const status = value => notify(options.onSaveStatus, value);
  const snapshotState = () => ({ values: structuredClone(state.values), dirty: [...state.dirty], archived: structuredClone(state.archived) });
  const assertAlive = () => { if (destroyed) throw new Error('UI renderer has been destroyed'); };
  const text = (template, limit) => template.replace('{limit}', String(limit));
  const domId = id => `${prefix}-${id}`;

  function h(tag, attrs = {}, ...children) {
    const element = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child) element.append(child);
    return element;
  }

  // Validates a committed envelope and its document. Returns null or an outcome object.
  function check(next) {
    if (!validators.committed(next)) return { outcome: 'rejected', diagnostics: validators.committed.errors.map(e => ({ code: 'INVALID_ENVELOPE', path: e.instancePath, message: e.message })) };
    const major = String(next.document?.schemaVersion || '').split('.')[0];
    if (major !== contract.protocolVersion.split('.')[0]) return { outcome: 'unsupported-protocol', diagnostics: [{ code: 'UNSUPPORTED_PROTOCOL_VERSION', path: '/document/schemaVersion', message: `Protocol ${next.document?.schemaVersion} is not supported.` }] };
    const result = validate(next.document, { contract, extensionValidators: options.extensionValidators });
    if (!result.valid) {
      const errors = result.diagnostics.filter(d => d.severity === 'error');
      const capability = errors.some(d => d.code === 'COMPONENT_UNAVAILABLE' || d.code === 'UNKNOWN_COMPONENT' || d.code === 'UNSUPPORTED_PROTOCOL_VERSION');
      return { outcome: capability ? 'incompatible-capabilities' : 'rejected', diagnostics: errors };
    }
    return null;
  }

  function render() {
    const focused = shadow.activeElement;
    const focusKey = focused?.dataset?.focusKey;
    fields = fieldsOf(committed.document); controls = new Map(); visibility = []; actionScopes = new Map();
    const root = h('div', { class: 'root', lang: options.lang });
    root.append(renderNode(committed.document.root, { form: null }));
    const style = h('style', { nonce: options.styleNonce }); style.textContent = styles;
    shadow.replaceChildren(style, root);
    updateVisibility();
    applyReadOnly();
    for (const [key, scope] of actionScopes) {
      if (busyKeys.has(key)) setBusy(scope, true);
      const previous = actionStatus.get(key);
      if (previous) setStatus(scope, previous.kind, previous.message);
    }
    if (focusKey) shadow.querySelector(`[data-focus-key="${focusKey.replace(/["\\]/g, '\\$&')}"]`)?.focus({ preventScroll: true });
  }
  function renderInvalid(diagnostics) {
    const style = h('style', { nonce: options.styleNonce }); style.textContent = styles;
    shadow.replaceChildren(style, h('div', { class: 'unavailable', role: 'alert', text: labels.invalidDocument }));
    report(Object.assign(new Error('Invalid UI document'), { diagnostics }));
  }

  function register(element, node) {
    if (node.visibleWhen) visibility.push({ element, conditions: [node.visibleWhen] });
    element.dataset.component = node.id;
    return element;
  }
  function renderChildren(children, context) { return (Array.isArray(children) ? children : []).map(child => renderNode(child, context)); }

  function renderNode(node, context) {
    const renderer = renderers[node.type];
    if (renderer) return register(renderer(node, context), node);
    const custom = options.renderers?.[node.type];
    if (custom && contract.components[node.type]?.extension) {
      try {
        const element = custom(structuredClone(node), { document: doc, labels, renderChildren: children => renderChildren(children, context) });
        if (element && typeof element === 'object' && 'nodeType' in element) return register(element, node);
      } catch (error) { report(error); }
    }
    return register(h('div', { class: 'unavailable', text: labels.unsupported }), node);
  }

  function fieldShell(node, control, { group = false } = {}) {
    const describedBy = [];
    const description = node.description ? h('p', { class: 'description', id: domId(`${node.id}-description`), text: node.description }) : null;
    if (description) describedBy.push(description.id);
    const error = h('p', { class: 'error', id: domId(`${node.id}-error`), hidden: true });
    describedBy.push(error.id);
    const label = group ? h('legend', { text: node.label }) : h('label', { for: domId(node.id), text: node.label });
    const wrapper = h(group ? 'fieldset' : 'div', { class: 'field', ...(group ? { 'aria-describedby': describedBy.join(' ') } : {}) }, label, control, description, error);
    if (!group) for (const element of control.matches?.('input,textarea,select') ? [control] : control.querySelectorAll('input,textarea,select')) element.setAttribute('aria-describedby', describedBy.join(' '));
    return { wrapper, error };
  }
  function bindControl(node, api) { controls.set(node.bind, api); }

  const headings = { heading1: 'h2', heading2: 'h3', heading3: 'h4' };
  const renderers = {
    Stack: (node, context) => h('div', { class: `stack ${node.direction || 'vertical'} gap-${node.gap || 'medium'} align-${node.align || 'stretch'}${node.wrap ? ' wrap' : ''}` }, renderChildren(node.children, context)),
    Grid: (node, context) => { const element = h('div', { class: `grid gap-${node.gap || 'medium'}` }, renderChildren(node.children, context)); element.style.setProperty('--columns', String(node.columns)); return element; },
    Card: (node, context) => {
      const titleId = node.title ? domId(`${node.id}-title`) : undefined;
      const header = node.title || node.description ? h('div', { class: 'card-header' }, node.title ? h('h3', { id: titleId, text: node.title }) : null, node.description ? h('p', { text: node.description }) : null) : null;
      return h('section', { class: 'card', 'aria-labelledby': titleId }, header, renderChildren(node.children, context));
    },
    Divider: () => h('hr'),
    Text: node => {
      const variant = node.variant || 'body', tone = node.tone && node.tone !== 'default' ? ` tone-${node.tone}` : '';
      if (variant === 'code') return h('pre', { class: tone.trim() || undefined }, h('code', { text: node.text }));
      return h(headings[variant] || 'p', { class: `${variant === 'caption' ? 'caption' : ''}${tone}`.trim() || undefined, text: node.text });
    },
    Image: node => {
      const fallback = () => h('div', { class: 'fallback', role: 'img', 'aria-label': node.alt || labels.imageUnavailable, text: `${labels.imageUnavailable}${node.alt ? `: ${node.alt}` : ''}` });
      if (checkUrl(node.src, 'image', contract.policy)) return fallback();
      const image = h('img', { src: node.src, alt: node.alt, width: node.width, height: node.height, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
      return h('figure', {}, image, node.caption ? h('figcaption', { text: node.caption }) : null);
    },
    Link: node => {
      if (checkUrl(node.href, 'link', contract.policy)) return h('span', { title: labels.linkBlocked, text: node.label });
      const external = contract.policy.link.target === 'blank';
      return h('a', { href: node.href, rel: 'noopener noreferrer', target: external ? '_blank' : undefined, referrerpolicy: 'no-referrer', text: node.label });
    },
    Input: node => {
      const kind = node.kind || 'text';
      const attrs = { id: domId(node.id), name: node.bind, 'data-focus-key': `bind:${node.bind}`, required: node.required, placeholder: node.placeholder, minlength: node.minLength, maxlength: node.maxLength };
      const control = node.multiline && kind === 'text' ? h('textarea', attrs)
        : h('input', { ...attrs, type: kind, inputmode: kind === 'number' ? 'decimal' : undefined, min: node.min, max: node.max, step: node.step ?? (kind === 'number' ? 'any' : undefined) });
      const { wrapper, error } = fieldShell(node, control);
      control.addEventListener('input', () => {
        let value = control.value;
        if (kind === 'number') value = control.value === '' ? null : Number.isFinite(control.valueAsNumber) ? control.valueAsNumber : Number.isFinite(Number(control.value)) ? Number(control.value) : null;
        userChange(node.bind, value);
      });
      bindControl(node, { focus: () => control.focus(), set: value => { const next = value === null || value === undefined ? '' : String(value); if (control.value !== next) control.value = next; }, error: problem => showError(control, error, problem), elements: [control] });
      return wrapper;
    },
    Choice: node => {
      const multiple = node.mode === 'multiple', display = node.display || (multiple ? 'checkbox' : 'radio');
      const options = Array.isArray(node.options) ? node.options : [];
      if (display === 'select') {
        const select = h('select', { id: domId(node.id), multiple, required: node.required, 'data-focus-key': `bind:${node.bind}` },
          multiple ? null : h('option', { value: '', text: labels.choose }),
          options.map(option => h('option', { value: option.value, text: option.label, title: option.description })));
        const { wrapper, error } = fieldShell(node, select);
        select.addEventListener('change', () => userChange(node.bind, multiple ? [...select.selectedOptions].map(o => o.value) : select.value));
        bindControl(node, { focus: () => select.focus(), set: value => { for (const option of select.options) option.selected = multiple ? Array.isArray(value) && value.includes(option.value) : option.value === value; }, error: problem => showError(select, error, problem), elements: [select] });
        return wrapper;
      }
      const name = domId(`${node.id}-choice`);
      const inputs = options.map((option, i) => h('input', { type: multiple ? 'checkbox' : 'radio', name, value: option.value, id: domId(`${node.id}-${i}`), 'data-focus-key': `bind:${node.bind}:${option.value}` }));
      const list = h('div', { class: `options${display === 'buttons' ? ' buttons' : ''}` },
        options.map((option, i) => h('label', { class: 'option', for: inputs[i].id }, inputs[i], h('span', {}, h('span', { text: option.label }), option.description ? h('small', { text: option.description }) : null))));
      const { wrapper, error } = fieldShell(node, list, { group: true });
      if (node.required) for (const input of inputs) input.setAttribute('aria-required', 'true');
      for (const input of inputs) input.addEventListener('change', () => userChange(node.bind, multiple ? inputs.filter(i => i.checked).map(i => i.value) : inputs.find(i => i.checked)?.value ?? ''));
      bindControl(node, { focus: () => (inputs.find(i => i.checked) || inputs[0])?.focus(), set: value => { for (const input of inputs) input.checked = multiple ? Array.isArray(value) && value.includes(input.value) : input.value === value; }, error: problem => { showError(null, error, problem); list.setAttribute('aria-invalid', String(Boolean(problem))); }, elements: inputs });
      return wrapper;
    },
    Toggle: node => {
      const input = h('input', { type: 'checkbox', role: 'switch', id: domId(node.id), 'data-focus-key': `bind:${node.bind}` });
      const description = node.description ? h('p', { class: 'description', id: domId(`${node.id}-description`), text: node.description }) : null;
      if (description) input.setAttribute('aria-describedby', description.id);
      input.addEventListener('change', () => userChange(node.bind, input.checked));
      bindControl(node, { focus: () => input.focus(), set: value => { input.checked = Boolean(value); }, error: () => {}, elements: [input] });
      return h('div', { class: 'field' }, h('label', { class: 'toggle', for: input.id }, input, h('span', { text: node.label })), description);
    },
    Slider: node => {
      const input = h('input', { type: 'range', id: domId(node.id), min: node.min, max: node.max, step: node.step ?? 1, 'data-focus-key': `bind:${node.bind}` });
      const output = h('output', { for: input.id, 'aria-hidden': 'true' });
      const { wrapper, error } = fieldShell(node, h('div', { class: 'slider' }, input, output));
      input.addEventListener('input', () => userChange(node.bind, input.valueAsNumber));
      bindControl(node, { focus: () => input.focus(), set: value => { input.value = String(value); output.textContent = String(value); input.setAttribute('aria-valuetext', String(value)); }, error: problem => showError(input, error, problem), elements: [input] });
      return wrapper;
    },
    Form: (node, context) => {
      const statusElement = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
      const form = h('form', { novalidate: true, id: domId(node.id) }, renderChildren(node.children, { ...context, form: node }), statusElement);
      const scope = { key: node.id, status: statusElement, buttons: () => form.querySelectorAll('button'), busy: false };
      form.addEventListener('submit', event => { event.preventDefault(); submit(node, scope, event.submitter?.dataset.component || node.id); });
      actionScopes.set(node.id, scope);
      return form;
    },
    Button: (node, context) => {
      const type = node.action?.type;
      const variant = node.variant || (type === 'submit' ? 'primary' : 'secondary');
      const button = h('button', { type: type === 'submit' && context.form ? 'submit' : 'button', class: variant, 'data-focus-key': `button:${node.id}`, text: node.label });
      if (type === 'reset' && context.form) button.addEventListener('click', () => resetForm(context.form));
      if (type === 'action') {
        const statusElement = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
        const scope = { key: node.id, status: statusElement, buttons: () => [button], busy: false };
        actionScopes.set(node.id, scope);
        button.addEventListener('click', () => runAction({ eventId: uuid(), documentId: committed.id, baseRevision: committed.revision, sourceId: node.id, actionId: node.action.actionId, values: {} }, scope));
        return h('span', { class: 'stack horizontal gap-small align-center' }, button, statusElement);
      }
      return button;
    },
    Tabs: (node, context) => {
      const tabs = Array.isArray(node.tabs) ? node.tabs : [];
      let active = view.tabs.get(node.id);
      if (!tabs.some(tab => tab.id === active)) active = tabs.some(tab => tab.id === node.defaultTab) ? node.defaultTab : tabs[0]?.id;
      const buttons = [], panels = [];
      const select = (id, focus) => {
        view.tabs.set(node.id, id);
        buttons.forEach(button => { const on = button.dataset.tab === id; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; if (on && focus) button.focus(); });
        panels.forEach(panel => { panel.hidden = panel.dataset.tab !== id; });
      };
      for (const tab of tabs) {
        const tabId = domId(`${node.id}-tab-${tab.id}`), panelId = domId(`${node.id}-panel-${tab.id}`);
        const button = h('button', { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId, 'data-tab': tab.id, 'data-focus-key': `tab:${node.id}:${tab.id}`, text: tab.label });
        button.addEventListener('click', () => select(tab.id, false));
        buttons.push(button);
        panels.push(h('div', { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: 0, 'data-tab': tab.id, class: 'stack vertical gap-medium' }, renderChildren(tab.children, context)));
      }
      const list = h('div', { role: 'tablist', 'aria-label': node.label }, buttons);
      list.addEventListener('keydown', event => {
        const index = buttons.findIndex(button => button.dataset.tab === view.tabs.get(node.id));
        const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(buttons[(next + buttons.length) % buttons.length].dataset.tab, true);
      });
      const element = h('div', { class: 'tabs' }, list, panels);
      select(active, false);
      return element;
    },
    Disclosure: (node, context) => {
      const open = view.open.has(node.id) ? view.open.get(node.id) : Boolean(node.defaultOpen);
      const panel = h('div', { id: domId(`${node.id}-panel`), hidden: !open }, renderChildren(node.children, context));
      const button = h('button', { type: 'button', 'aria-expanded': String(open), 'aria-controls': panel.id, 'data-focus-key': `disclosure:${node.id}`, text: node.label });
      button.addEventListener('click', () => { const next = button.getAttribute('aria-expanded') !== 'true'; view.open.set(node.id, next); button.setAttribute('aria-expanded', String(next)); panel.hidden = !next; });
      return h('div', { class: 'disclosure' }, button, panel);
    },
    Table: node => {
      const rows = committed.document.datasets?.[node.dataset]?.rows || [];
      const columns = Array.isArray(node.columns) ? node.columns : [];
      const body = h('tbody');
      const headers = columns.map(column => h('th', { scope: 'col', class: column.format === 'number' ? 'number' : undefined }));
      const format = (column, value) => value === null || value === undefined ? '' : column.format === 'number' && typeof value === 'number' ? value.toLocaleString(options.lang) : String(value);
      const draw = () => {
        const sort = view.sort.get(node.id);
        const sorted = sort ? [...rows].sort((a, b) => {
          const x = a?.[sort.field], y = b?.[sort.field];
          const order = x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), options.lang);
          return sort.direction === 'descending' ? -order : order;
        }) : rows;
        headers.forEach((th, i) => { if (node.sortable) th.setAttribute('aria-sort', sort?.field === columns[i].field ? sort.direction : 'none'); });
        body.replaceChildren(...(sorted.length ? sorted.map(row => h('tr', {}, columns.map(column => h('td', { class: column.format === 'number' ? 'number' : undefined, text: format(column, row?.[column.field]) })))) : [h('tr', {}, h('td', { colspan: Math.max(columns.length, 1), class: 'caption', text: node.emptyText || labels.empty }))]));
      };
      headers.forEach((th, i) => {
        if (!node.sortable) { th.textContent = columns[i].label; return; }
        const button = h('button', { type: 'button', 'data-focus-key': `sort:${node.id}:${columns[i].field}`, text: columns[i].label });
        button.addEventListener('click', () => { const current = view.sort.get(node.id); view.sort.set(node.id, { field: columns[i].field, direction: current?.field === columns[i].field && current.direction === 'ascending' ? 'descending' : 'ascending' }); draw(); });
        th.append(button);
      });
      draw();
      const table = h('table', {}, node.caption ? h('caption', { text: node.caption }) : null, h('thead', {}, h('tr', {}, headers)), body);
      return h('div', { class: 'table-wrap', role: 'region', tabindex: 0, 'aria-label': node.caption || node.dataset }, table);
    },
    Chart: node => renderChart(node, committed.document.datasets?.[node.dataset]?.rows || [], { document: doc, h, labels, lang: options.lang }),
    WebPreview: node => {
      const linkAllowed = !checkUrl(node.url, 'link', contract.policy);
      const link = linkAllowed ? h('a', { href: node.url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', text: `${labels.openOriginal}: ${node.title}` }) : null;
      if (checkUrl(node.url, 'webPreview', contract.policy)) return h('div', { class: 'fallback' }, h('p', { text: labels.previewBlocked }), link);
      const frame = h('iframe', { src: node.url, title: node.title, sandbox: sandboxFor(node.url, contract.policy, options.pageOrigin ?? win?.location?.origin), referrerpolicy: 'no-referrer', loading: 'lazy', allow: '' });
      frame.style.height = `${node.height || 480}px`;
      return h('figure', { class: 'preview' }, frame, h('figcaption', {}, link, h('span', { class: 'caption', text: ` ${labels.previewHint}` })));
    }
  };

  function showError(control, element, problem) {
    element.hidden = !problem;
    element.textContent = problem ? text(labels[problem.code] || labels.invalid_value, problem.limit) : '';
    control?.setAttribute('aria-invalid', String(Boolean(problem)));
  }
  function syncControls() { for (const [bind, control] of controls) control.set(state.values[bind]); }
  function updateVisibility() { for (const { element, conditions } of visibility) element.hidden = !isVisible(conditions, state.values); }
  function applyReadOnly() {
    for (const element of shadow.querySelectorAll('input,textarea,select,form button')) element.disabled = Boolean(options.readOnly);
    for (const scope of actionScopes.values()) if (!scope.busy) for (const button of scope.buttons()) button.disabled = Boolean(options.readOnly);
  }

  function userChange(bind, value) {
    if (options.readOnly || destroyed) return;
    const field = fields.get(bind);
    if (!field || JSON.stringify(state.values[bind]) === JSON.stringify(value)) return;
    state.values[bind] = value;
    if (!state.dirty.includes(bind)) state.dirty.push(bind);
    controls.get(bind)?.error(null);
    if (field.node.type === 'Slider') controls.get(bind)?.set(value);
    updateVisibility();
    changed({ type: 'field', bind });
  }
  function changed(context) {
    changeId++; pending = true;
    notify(options.onStateChange, snapshotState(), { ...context, changeId, documentId: committed.id, revision: committed.revision });
    if (options.onSave) status('pending');
    schedule();
  }
  function resetForm(form) {
    if (options.readOnly) return;
    for (const [bind, field] of fields) if (field.form?.id === form.id) { state.values[bind] = defaultValue(field); state.dirty = state.dirty.filter(b => b !== bind); controls.get(bind)?.error(null); }
    syncControls(); updateVisibility();
    changed({ type: 'reset', formId: form.id });
  }

  function submit(form, scope, sourceId) {
    if (options.readOnly || scope.busy || destroyed) return;
    const submitted = formFields(committed.document, form.id, state.values);
    let first;
    for (const [bind, field] of submitted) {
      const problem = checkField(field, state.values[bind]);
      controls.get(bind)?.error(problem);
      if (problem && !first) first = bind;
    }
    if (first) { setStatus(scope, 'invalid', labels.invalid); controls.get(first)?.focus(); return; }
    runAction({ eventId: uuid(), documentId: committed.id, baseRevision: committed.revision, sourceId, actionId: form.submitAction, values: Object.fromEntries(submitted.map(([bind]) => [bind, structuredClone(state.values[bind])])) }, scope);
  }
  function setStatus(scope, kind, message) {
    scope.status.className = `status ${kind}`; scope.status.textContent = message || '';
    actionStatus.set(scope.key, { kind, message });
  }
  function setBusy(scope, busy) {
    scope.busy = busy; busy ? busyKeys.add(scope.key) : busyKeys.delete(scope.key);
    scope.status.closest('form')?.setAttribute('aria-busy', String(busy));
    for (const button of scope.buttons()) button.disabled = busy || Boolean(options.readOnly);
  }
  // Updates the scope currently rendered for a key, or remembers the status for the next render.
  function statusFor(key, kind, message) { const scope = actionScopes.get(key); if (scope) setStatus(scope, kind, message); else actionStatus.set(key, { kind, message }); }
  async function runAction(event, scope) {
    if (options.readOnly || scope.busy || destroyed) return;
    if (!options.onAction) { setStatus(scope, 'failed', labels.failed); report(new Error('No onAction handler is configured')); return; }
    const controller = new AbortController(), generation = epoch;
    actionControllers.add(controller);
    const key = scope.key;
    setBusy(scope, true); setStatus(scope, 'pending', labels.submitting);
    eventKeys.set(event.eventId, key);
    if (eventKeys.size > 100) eventKeys.delete(eventKeys.keys().next().value);
    try {
      const result = await options.onAction(structuredClone(event), { signal: controller.signal });
      if (destroyed || generation !== epoch) return;
      const kind = result?.status || 'succeeded';
      // A later status pushed by the host (for example after the Agent replied) must not be overwritten.
      if (actionStatus.get(key)?.kind === 'pending') statusFor(key, kind, result?.message || labels[kind] || labels.succeeded);
    } catch (error) {
      if (destroyed || controller.signal.aborted) return;
      statusFor(key, 'failed', labels.failed); report(error);
    } finally {
      actionControllers.delete(controller);
      if (!destroyed && generation === epoch) { const live = actionScopes.get(key); if (live) setBusy(live, false); else busyKeys.delete(key); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (options.onSave && pending && !destroyed) timer = setTimeout(() => flush().catch(() => {}), options.debounceMs);
  }
  async function flush() {
    assertAlive(); clearTimeout(timer);
    if (saving) { await saving; return pending && options.onSave ? flush() : snapshotState(); }
    if (!pending || !options.onSave) return snapshotState();
    saving = (async () => {
      while (pending && !destroyed && options.onSave) {
        pending = false;
        const snapshot = snapshotState(), controller = new AbortController();
        activeSave = controller; status('saving');
        try {
          await options.onSave(snapshot, { signal: controller.signal, documentId: committed.id, revision: committed.revision, changeId });
          status(pending ? 'pending' : 'saved');
        } catch (error) {
          if (destroyed) return snapshot;
          pending = true; status('error'); report(error); throw error;
        } finally { if (activeSave === controller) activeSave = undefined; }
      }
      return snapshotState();
    })();
    try { return await saving; } finally { saving = undefined; }
  }

  function apply(next, { reset = [] } = {}) {
    assertAlive();
    const problem = check(next);
    if (problem) { report(Object.assign(new Error(`UI document ${problem.outcome}`), problem)); return problem; }
    if (committed && next.id === committed.id) {
      if (next.revision < committed.revision) return { outcome: 'stale' };
      if (next.revision === committed.revision) return { outcome: canonicalJSON(next.document) === canonicalJSON(committed.document) ? 'unchanged' : 'conflict' };
    }
    const incoming = structuredClone(next);
    let outcomes = [];
    if (committed && incoming.id === committed.id) {
      ({ state, outcomes } = mergeState({ previous: committed.document, next: incoming.document, local: state, incoming: incoming.state, reset, revision: incoming.revision }));
    } else {
      // A different document replaces this one; unsaved state belongs to the old document and is flushed first by hosts that need it.
      epoch++; activeSave?.abort(); clearTimeout(timer); pending = false;
      for (const controller of actionControllers) controller.abort();
      actionStatus.clear(); busyKeys.clear(); eventKeys.clear();
      state = initialState(incoming.document, incoming.state);
      view.tabs.clear(); view.open.clear(); view.sort.clear();
    }
    committed = incoming;
    render(); syncControls();
    if (outcomes.length) notify(options.onMerge, structuredClone(outcomes), { documentId: committed.id, revision: committed.revision });
    if (outcomes.some(o => o.outcome !== 'reset') || reset.length) changed({ type: 'merge' });
    else if (pending) schedule();
    return { outcome: 'applied', merge: outcomes };
  }

  const first = check(options.document);
  if (first) {
    committed = options.document && typeof options.document === 'object' ? structuredClone(options.document) : null;
    renderInvalid(first.diagnostics);
  } else {
    committed = structuredClone(options.document);
    state = initialState(committed.document, committed.state);
    render(); syncControls();
  }

  return {
    element: host,
    apply,
    getState: () => { assertAlive(); return snapshotState(); },
    getDocument: () => { assertAlive(); return { ...structuredClone(committed), state: snapshotState() }; },
    update(settings = {}) {
      assertAlive();
      const next = { ...options, ...settings };
      checkSettings(next);
      const hadSave = Boolean(options.onSave);
      options = next;
      Object.assign(labels, settings.labels || {});
      if (settings.readOnly !== undefined) applyReadOnly();
      if (pending && options.onSave && !hadSave) { status('pending'); schedule(); }
    },
    /** Shows a later status for an event, for example one pushed by the host after the Agent responded. */
    setActionStatus(eventId, kind, message) {
      const key = eventKeys.get(eventId);
      if (key && ['accepted', 'succeeded', 'failed'].includes(kind)) statusFor(key, kind, message || labels[kind]);
    },
    flush,
    destroy() {
      if (destroyed) return;
      destroyed = true; clearTimeout(timer); activeSave?.abort();
      for (const controller of actionControllers) controller.abort();
      host.remove();
    }
  };
}

function checkSettings(options) {
  if (!Number.isFinite(options.debounceMs) || options.debounceMs < 0) throw new TypeError('debounceMs must be nonnegative');
  for (const name of ['onAction', 'onStateChange', 'onSave', 'onMerge', 'onSaveStatus', 'onError']) if (options[name] !== undefined && typeof options[name] !== 'function') throw new TypeError(`${name} must be a function`);
}
