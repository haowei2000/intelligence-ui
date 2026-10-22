import { validate, fix, createContract } from '../agent.mjs';
import { commitDocument } from '../protocol.mjs';
import { mountUI } from '../runtime.mjs';

const $ = id => document.getElementById(id);
const broken = '```json\n' + JSON.stringify({
  root: { type: 'Card', id: 'card', title: 'Broken output', children: [
    { type: 'Row', id: 'row', children: [] },
    { type: 'Slider', id: 'budget', bind: 'budget', label: 'Budget', min: '100', max: '50' },
    { type: 'Form', id: 'form', submitAction: 'book-now', children: [{ type: 'Choice', id: 'pick', bind: 'pick', label: 'Pick', mode: 'Single', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }] },
    { type: 'Image', id: 'img', src: 'javascript:alert(1)', alt: '' }
  ] }
}, null, 2) + '\n```';
let ui, committed, revision = 0;

function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function contract() {
  try { const options = JSON.parse($('contract').value || '{}'); const result = createContract(options); $('contract-id').textContent = `contract ${result.id}`; return result; }
  catch (error) { $('contract-id').textContent = `contract options invalid: ${error.message}`; return createContract(); }
}
function show(result) {
  $('verdict').textContent = result.valid ? 'valid' : 'invalid';
  $('verdict').className = `badge ${result.valid ? 'valid' : 'invalid'}`;
  $('diagnostics').replaceChildren(...result.diagnostics.map(d => {
    const item = element('li');
    item.append(element('span', d.severity, `sev-${d.severity}`), ' ', element('span', d.code, 'code'), ' ', element('span', d.path || '/', 'code'), ` ${d.message}`);
    if (d.suggestion) item.append(element('div', d.suggestion, 'muted'));
    if (d.autofix) item.append(element('div', `Autofix: ${d.autofix.rule}`, 'muted'));
    return item;
  }));
  $('fixes').replaceChildren(...(result.applied || []).map(change => {
    const item = element('li');
    item.append(element('span', change.rule, 'code'), ' ', element('span', change.path || '/', 'code'), ` ${change.reason}`);
    return item;
  }));
}
function log(list, text) { const item = element('li', text); $(list).prepend(item); }

async function loadExample(name) {
  $('document').value = name === 'broken' ? broken : JSON.stringify(await (await fetch(`../protocol/examples/${name}.json`)).json(), null, 2);
  show(validate($('document').value, { contract: contract() }));
}
function render(next) {
  const options = {
    document: next, contract: contract(),
    onAction: async event => { log('events', `${event.actionId} from ${event.sourceId}: ${JSON.stringify(event.values)}`); await new Promise(r => setTimeout(r, 400)); return { status: 'succeeded', message: 'Handled by the playground.' }; },
    onStateChange: state => { $('state').textContent = JSON.stringify(state, null, 2); },
    onMerge: outcomes => outcomes.forEach(o => log('merge', `${o.bind}: ${o.outcome}${o.removed ? ` (${o.removed.join(', ')})` : ''}`)),
    onError: error => log('events', `error: ${error.message}`)
  };
  if (!ui) ui = mountUI($('surface'), options);
  else { const result = ui.apply(next); if (result.outcome !== 'applied') log('merge', `apply: ${result.outcome}`); }
  committed = ui.getDocument();
  $('revision').textContent = `${committed.id} · revision ${committed.revision}`;
  $('state').textContent = JSON.stringify(ui.getState(), null, 2);
}
function candidateOrReport() {
  const result = fix($('document').value, { contract: contract() });
  show(result);
  return result.valid ? result.document : null;
}

$('example').addEventListener('change', event => loadExample(event.target.value));
$('validate').addEventListener('click', () => show(validate($('document').value, { contract: contract() })));
$('fix').addEventListener('click', () => {
  const result = fix($('document').value, { contract: contract() });
  show(result);
  const output = result.valid ? result.document : result.candidate;
  if (output !== undefined) $('document').value = JSON.stringify(output, null, 2);
});
$('publish').addEventListener('click', () => {
  const candidate = candidateOrReport();
  if (!candidate) return;
  ui?.destroy(); ui = undefined;
  $('events').replaceChildren(); $('merge').replaceChildren();
  revision = 1;
  render(commitDocument(candidate, { id: 'playground', revision }).committed);
});
$('apply').addEventListener('click', () => {
  const candidate = candidateOrReport();
  if (!candidate) return;
  if (!ui) { $('publish').click(); return; }
  revision = committed.revision + 1;
  render(commitDocument(candidate, { id: 'playground', revision, previous: committed, state: ui.getState() }).committed);
});
$('contract').addEventListener('change', () => show(validate($('document').value, { contract: contract() })));
await loadExample('trip-plan');
