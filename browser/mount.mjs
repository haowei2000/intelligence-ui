import { validateDocument, escapeHtml } from '../lib/document.mjs';

const css = `:host{display:block;color:var(--document-text,#263b52);font:15px/1.7 system-ui,sans-serif}*{box-sizing:border-box}main{max-width:800px;margin:auto;padding:24px}h1{font-size:26px;line-height:1.4;margin:0 0 12px}h2{font-size:17px;margin:0 0 8px}p{margin:0;color:var(--document-muted,#728092)}header,section{padding:20px 0;border-bottom:1px solid var(--document-border,#e2e8ee)}header{padding-top:0}.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}.option{display:flex;align-items:start;gap:12px;text-align:left;padding:16px;background:var(--document-background,#fff);border:1px solid var(--document-border,#e2e8ee);border-radius:8px}.option[aria-pressed=true]{border-color:var(--document-accent,#367c6b);background:var(--document-selected,#f0f8f5)}.option strong,.option small{display:block}.option small{font-size:12px;color:var(--document-muted,#728092);margin-top:5px}.radio{width:16px;height:16px;border:1px solid #a5b3bf;border-radius:50%;flex-shrink:0;margin-top:5px}[aria-pressed=true] .radio{border:5px solid var(--document-accent,#367c6b)}textarea,input:not([type=checkbox]):not([type=radio]),select{max-width:100%;border:1px solid var(--document-border,#e2e8ee);border-radius:6px;padding:10px;background:var(--document-background,#fff)}textarea{width:100%;min-height:100px;resize:vertical}label{display:block;margin:12px 0}button:disabled{cursor:default;opacity:.6}:focus-visible{outline:3px solid var(--document-accent,#367c6b);outline-offset:3px}pre{overflow:auto}img{max-width:100%}@media(max-width:480px){main{padding:16px}.options{grid-template-columns:1fr}}`;

const allowedTags = new Set('ARTICLE SECTION DIV HEADER FOOTER MAIN H1 H2 H3 H4 H5 H6 P SPAN STRONG EM B I U SMALL UL OL LI DL DT DD BLOCKQUOTE PRE CODE HR BR TABLE THEAD TBODY TR TH TD CAPTION FORM LABEL INPUT TEXTAREA SELECT OPTION OPTGROUP BUTTON DETAILS SUMMARY'.split(' '));
const allowedAttrs = new Set('class id type name value checked selected multiple required min max step maxlength placeholder disabled readonly rows cols for open colspan rowspan data-field'.split(' '));

function safeMarkup(html, ownerDocument) {
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowedTags.has(element.tagName)) { element.remove(); continue; }
    for (const attr of [...element.attributes]) {
      if (!allowedAttrs.has(attr.name) && !attr.name.startsWith('aria-')) element.removeAttribute(attr.name);
    }
    if (element.tagName === 'INPUT' && !['text', 'number', 'checkbox', 'radio', 'range', 'date', 'time', 'email', 'url', 'tel', 'color', 'hidden'].includes(element.type)) element.type = 'text';
    if (element.tagName === 'BUTTON') element.type = 'button';
  }
  return template.content;
}

// Custom CSS must not fetch: url()/@import/image-set() would load from the host origin and can leak field values via attribute selectors.
function safeCss(text) {
  const decoded = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : char);
  return /@import|(?:url|image|image-set|src|cross-fade|element)\s*\(/i.test(decoded) ? undefined : text;
}

/** Mounts a document inside a scoped Shadow DOM. Persistence belongs to the caller. */
export function mountDocument(container, initialOptions) {
  if (!container?.ownerDocument || typeof container.append !== 'function') throw new TypeError('container must be a DOM element');
  let options = { debounceMs: 300, ...initialOptions };
  if (!Number.isFinite(options.debounceMs) || options.debounceMs < 0) throw new TypeError('debounceMs must be nonnegative');
  let current = structuredClone(validateDocument(options.document));
  let destroyed = false, pending = false, timer, saving, activeSave, epoch = 0, changeId = 0, layoutKey, layoutParts, notesVisible = false, lastEmitted;
  const host = container.ownerDocument.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const originalDisabled = new WeakMap();
  container.append(host);

  function report(error) { if (!destroyed) options.onError?.(error); }
  function notify(callback, ...args) { if (!destroyed && callback) { try { callback(...args); } catch (error) { report(error); } } }
  function status(value) { notify(options.onSaveStatus, value); }
  function snapshot() { return structuredClone(current); }
  function assertAlive() { if (destroyed) throw new Error('Document renderer has been destroyed'); }
  function syncControls() {
    for (const button of shadow.querySelectorAll('[data-decision]')) button.setAttribute('aria-pressed', String(current.state.selections[button.dataset.decision] === button.dataset.option));
    const notes = shadow.querySelector('[data-notes]');
    if (notes && notes.value !== current.state.notes) notes.value = current.state.notes;
    for (const field of shadow.querySelectorAll('[data-field]')) {
      const values = current.state.values || {};
      if (!Object.hasOwn(values, field.dataset.field)) {
        if (field.type === 'checkbox' || field.type === 'radio') field.checked = field.defaultChecked;
        else if (field.tagName === 'SELECT') {
          if (field.multiple) for (const option of field.options) option.selected = option.defaultSelected;
          else field.value = [...field.options].find(option => option.defaultSelected)?.value ?? field.options[0]?.value ?? '';
        }
        else if ('value' in field) field.value = field.defaultValue || '';
        continue;
      }
      const value = values[field.dataset.field];
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else if (field.type === 'radio') field.checked = field.value === value;
      else if (field.tagName === 'SELECT' && field.multiple) for (const option of field.options) option.selected = Array.isArray(value) && value.includes(option.value);
      else if ('value' in field && field.value !== String(value ?? '')) field.value = String(value ?? '');
    }
    for (const element of shadow.querySelectorAll('input,textarea,select,button')) {
      if (!originalDisabled.has(element)) originalDisabled.set(element, element.disabled);
      element.disabled = Boolean(options.readOnly || originalDisabled.get(element));
    }
  }
  function render() {
    // Once shown, the notes box stays until the document is replaced, so clearing notes never removes the focused textarea.
    notesVisible ||= current.decisions.length > 0 || Boolean(current.state.notes);
    const parts = [current.title, current.description, current.decisions, current.ui, notesVisible];
    const key = layoutParts && parts.every((part, i) => part === layoutParts[i]) ? layoutKey : JSON.stringify(parts);
    layoutParts = parts;
    if (key !== layoutKey) {
      layoutKey = key;
      const customCss = current.ui.css ? safeCss(current.ui.css) : '';
      if (customCss === undefined) report(new Error('ui.css contains url(), @import or other external resource references and was not applied'));
      const style = container.ownerDocument.createElement('style'); style.textContent = css + '\n' + (customCss || ''); if (options.styleNonce) style.nonce = options.styleNonce;
      const main = container.ownerDocument.createElement('main');
      const template = container.ownerDocument.createElement('template');
      template.innerHTML = `<header><h1>${escapeHtml(current.title)}</h1>${current.description ? `<p>${escapeHtml(current.description)}</p>` : ''}</header>`;
      main.append(template.content);
      if (current.ui.html) { const section = container.ownerDocument.createElement('section'); section.append(safeMarkup(current.ui.html, container.ownerDocument)); main.append(section); }
      for (const decision of current.decisions) {
        const template = container.ownerDocument.createElement('template');
        template.innerHTML = `<section><h2>${escapeHtml(decision.title)}</h2>${decision.description ? `<p>${escapeHtml(decision.description)}</p>` : ''}<div class="options">${decision.options.map(option => `<button type="button" class="option" data-decision="${escapeHtml(decision.id)}" data-option="${escapeHtml(option.id)}" aria-pressed="false"><span class="radio" aria-hidden="true"></span><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ''}</span></button>`).join('')}</div></section>`;
        main.append(template.content);
      }
      if (notesVisible) {
        const section = container.ownerDocument.createElement('section'); section.innerHTML = '<h2>决策备注</h2><textarea data-notes aria-label="决策备注"></textarea>'; main.append(section);
      }
      shadow.replaceChildren(style, main);
    }
    if (options.styleNonce) shadow.querySelector('style').nonce = options.styleNonce;
    syncControls();
  }
  function schedule() {
    clearTimeout(timer);
    if (options.onSave && pending && !destroyed) timer = setTimeout(() => flush().catch(() => {}), options.debounceMs);
  }
  function change(state, context) {
    if (JSON.stringify(current.state) === JSON.stringify(state)) return;
    // Only state changes here; the rest of current is owned by the renderer and kept by reference.
    current = validateDocument({ ...current, state: structuredClone(state) }); changeId++; pending = true;
    syncControls();
    lastEmitted = snapshot();
    notify(options.onChange, lastEmitted, { ...context, changeId });
    if (options.onSave) status('pending');
    schedule();
  }
  function click(event) {
    const button = event.target.closest?.('[data-decision]');
    if (!button || options.readOnly || button.disabled) return;
    const { decision: decisionId, option: optionId } = button.dataset;
    if (!current.decisions.find(d => d.id === decisionId)?.options.some(o => o.id === optionId)) return;
    change({ ...current.state, selections: { ...current.state.selections, [decisionId]: optionId } }, { type: 'selection', decisionId });
  }
  function input(event) {
    if (options.readOnly) return;
    const element = event.target;
    if (element.disabled || element.readOnly) return;
    try {
      if (element.matches?.('[data-notes]')) { change({ ...current.state, notes: element.value }, { type: 'notes' }); return; }
      if (!element.matches?.('input[data-field],textarea[data-field],select[data-field]')) return;
      const field = element.dataset.field;
      let value = element.value;
      if (element.type === 'checkbox') value = element.checked;
      else if (element.type === 'radio' && !element.checked) return;
      else if (element.type === 'number' || element.type === 'range') value = element.value === '' ? null : element.valueAsNumber;
      else if (element.multiple && element.tagName === 'SELECT') value = [...element.selectedOptions].map(option => option.value);
      change({ ...current.state, values: { ...current.state.values, [field]: value } }, { type: 'field', field });
    } catch (error) { render(); report(error); }
  }
  shadow.addEventListener('click', click);
  shadow.addEventListener('input', input);
  shadow.addEventListener('change', input);
  const preventSubmit = event => event.preventDefault();
  shadow.addEventListener('submit', preventSubmit);

  async function flush() {
    assertAlive(); clearTimeout(timer);
    if (saving) { await saving; return pending ? flush() : snapshot(); }
    if (!pending || !options.onSave) return snapshot();
    saving = (async () => {
      while (pending && !destroyed && options.onSave) {
        pending = false;
        const document = snapshot(), sequence = changeId, generation = epoch;
        const controller = new AbortController(); activeSave = controller;
        status('saving');
        try {
          const saved = await options.onSave(document, { signal: controller.signal, changeId: sequence, documentId: document.manifest.id, baseRevision: document.manifest.revision });
          if (destroyed) return document;
          if (generation !== epoch) continue;
          if (saved !== undefined) {
            validateDocument(saved);
            if (saved.manifest.id !== document.manifest.id) throw new Error('onSave returned a different document ID');
            current = sequence === changeId ? structuredClone(saved) : { ...current, manifest: structuredClone(saved.manifest) };
            render();
            // Echo server metadata to controlled hosts without scheduling a save.
            lastEmitted = snapshot();
            notify(options.onChange, lastEmitted, { type: 'saved', changeId });
          }
          notify(options.onSaved, structuredClone(saved || document));
          status(pending ? 'pending' : 'saved');
        } catch (error) {
          if (destroyed || generation !== epoch) continue;
          pending = true; status('error'); report(error); throw error;
        } finally { if (activeSave === controller) activeSave = undefined; }
      }
      return snapshot();
    })();
    try { return await saving; } finally { saving = undefined; }
  }
  try { render(); } catch (error) { host.remove(); throw error; }
  return {
    element: host,
    getDocument: () => { assertAlive(); return snapshot(); },
    update(document, settings = {}) {
      assertAlive();
      // Echoes of our own onChange snapshot (controlled React use) need no validation or comparison.
      const next = document === undefined || document === lastEmitted ? undefined : structuredClone(validateDocument(document));
      const nextOptions = { ...options, ...settings };
      if (!Number.isFinite(nextOptions.debounceMs) || nextOptions.debounceMs < 0) throw new TypeError('debounceMs must be nonnegative');
      const hadSave = Boolean(options.onSave);
      options = nextOptions;
      if (next && JSON.stringify(next) !== JSON.stringify(current)) {
        epoch++; activeSave?.abort(); clearTimeout(timer); pending = false; notesVisible = false; current = next; status('idle');
      } else if (pending && options.onSave && !hadSave) {
        // Edits made before a save handler existed are saved once one arrives.
        status('pending'); schedule();
      }
      render();
    },
    flush,
    destroy() {
      if (!destroyed) {
        destroyed = true; clearTimeout(timer); activeSave?.abort();
        shadow.removeEventListener('click', click);
        shadow.removeEventListener('input', input);
        shadow.removeEventListener('change', input);
        shadow.removeEventListener('submit', preventSubmit);
        host.remove();
      }
    }
  };
}
