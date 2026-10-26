import * as validators from './validators.mjs';
import { catalog } from './catalog.mjs';
import { standardContract } from './contract.mjs';
import { checkUrl } from './url.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FENCE = /^\s*```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n\s*```\s*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export const pointer = parts => parts.map(part => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
export function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const current = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; }
  }
  return row[b.length];
}
const nearest = (value, candidates, max = 2) => candidates.map(candidate => [candidate, distance(value, candidate)]).filter(([, d]) => d <= max).sort((x, y) => x[1] - y[1]).map(([candidate]) => candidate);

class Collector {
  constructor(max) { this.max = max; this.items = []; this.truncated = false; this.keys = new Set(); }
  get full() { return this.truncated; }
  add(diagnostic) {
    if (this.truncated) return;
    const key = `${diagnostic.code}|${diagnostic.path}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    if (this.items.length >= this.max) {
      this.truncated = true;
      this.items.push({ code: 'DIAGNOSTICS_TRUNCATED', path: '', severity: 'error', message: `Stopped after ${this.max} diagnostics; fix these and validate again.` });
      return;
    }
    this.items.push({ severity: 'error', ...diagnostic });
  }
}
const describe = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const getAt = (root, parts) => parts.reduce((value, part) => value?.[part], root);

// Property names allowed at a path inside a node, for "did you mean" suggestions.
function allowedKeys(type, parts) {
  if (!type) return parts.length ? [] : ['schemaVersion', 'title', 'root', 'datasets'];
  const spec = catalog.components[type];
  if (!spec) return [];
  if (!parts.length) return ['type', 'id', 'visibleWhen', ...Object.keys(spec.props)];
  let schema = parts[0] === 'visibleWhen' ? catalog.visibleWhen.schema : spec.props[parts[0]]?.schema;
  for (const part of parts.slice(1)) schema = /^\d+$/.test(part) ? schema?.items : schema?.properties?.[part];
  return Object.keys(schema?.properties || {});
}

/** Maps Ajv errors for one node into diagnostics. `base` is the node's path segments. */
function ajvDiagnostics(errors, base, node, out) {
  for (const error of errors || []) {
    const parts = error.instancePath ? error.instancePath.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')) : [];
    const path = [...base, ...parts], actual = getAt(node, parts);
    switch (error.keyword) {
      case 'required':
        if (!base.length && error.params.missingProperty === 'schemaVersion') {
          out.add({ code: 'MISSING_PROPERTY', path: pointer([...path, 'schemaVersion']), message: 'Missing required property schemaVersion.', expected: { property: 'schemaVersion' }, autofix: { rule: 'add-schema-version' } });
        } else out.add({ code: 'MISSING_PROPERTY', path: pointer([...path, error.params.missingProperty]), message: `Missing required property ${error.params.missingProperty}.`, expected: { property: error.params.missingProperty } });
        break;
      case 'additionalProperties': {
        const name = error.params.additionalProperty;
        const allowed = allowedKeys(base.length ? node?.type : null, parts);
        const close = allowed.length ? nearest(name, allowed) : [];
        out.add({ code: 'UNKNOWN_PROPERTY', path: pointer([...path, name]), message: `Unknown property ${name}.`, ...(close.length ? { suggestion: `Did you mean ${close[0]}? Rename it only if the value matches that property.`, proposedPatch: [{ op: 'move', from: pointer([...path, name]), path: pointer([...path, close[0]]) }], preconditions: [`${close[0]} is not already set`] } : { suggestion: 'Remove the property; standard components do not accept extra properties.' }) });
        break;
      }
      case 'type': {
        const expected = error.params.type.split(',');
        let autofix;
        if (typeof actual === 'string' && expected.some(t => t === 'number' || t === 'integer')) {
          const text = actual.trim();
          if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text) && (!expected.includes('integer') || expected.includes('number') || /^-?\d+$/.test(text))) autofix = { rule: 'coerce-numeric-string', value: Number(text) };
        } else if (expected.includes('boolean') && (actual === 'true' || actual === 'false')) autofix = { rule: 'coerce-boolean-string', value: actual === 'true' };
        out.add({ code: 'WRONG_TYPE', path: pointer(path), message: `Expected ${expected.join(' or ')}, got ${describe(actual)}.`, expected: { type: expected }, ...(autofix ? { autofix } : {}) });
        break;
      }
      case 'enum': {
        const allowed = error.params.allowedValues;
        const matches = typeof actual === 'string' ? allowed.filter(v => typeof v === 'string' && v.toLowerCase() === actual.trim().toLowerCase()) : [];
        out.add({ code: 'INVALID_ENUM', path: pointer(path), message: `Value ${JSON.stringify(actual)} is not allowed.`, expected: { allowed }, ...(matches.length === 1 ? { autofix: { rule: 'normalize-enum-case', value: matches[0] } } : { suggestion: `Use one of: ${allowed.map(v => JSON.stringify(v)).join(', ')}.` }) });
        break;
      }
      case 'const':
        out.add({ code: 'INVALID_VALUE', path: pointer(path), message: `Expected ${JSON.stringify(error.params.allowedValue)}.`, expected: { value: error.params.allowedValue } });
        break;
      case 'pattern':
        out.add({ code: 'INVALID_FORMAT', path: pointer(path), message: `Value does not match the required format.`, expected: { pattern: error.params.pattern } });
        break;
      case 'propertyNames':
        out.add({ code: 'INVALID_KEY', path: pointer([...path, error.params.propertyName]), message: `Key ${JSON.stringify(error.params.propertyName)} is not allowed here.` });
        break;
      case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum': case 'minLength': case 'maxLength': case 'minItems': case 'maxItems': case 'maxProperties':
        out.add({ code: 'OUT_OF_RANGE', path: pointer(path), message: `Value ${error.message}.`, expected: { [error.keyword]: error.params.limit } });
        break;
      case 'anyOf': case 'oneOf': case 'if': break;
      default:
        out.add({ code: 'INVALID_VALUE', path: pointer(path), message: error.message || 'Invalid value.' });
    }
  }
}

/** Field value type for a binding component: string, number, boolean or string[]. */
export function bindingKind(node, spec = catalog.components[node.type]) {
  const binding = spec?.binding;
  if (!binding) return null;
  if (binding.type) return binding.type;
  const value = node[binding.byProp] ?? spec.props[binding.byProp]?.default;
  return binding.map[value] ?? binding.map['*'] ?? null;
}

// Iterative raw nesting check so cloning and traversal never recurse unboundedly. A component level
// uses at most four JSON levels (tabs -> tab -> children -> component).
function tooDeep(value, limits) {
  const max = limits.maxDepth * 4 + 8;
  const stack = [[value, 1]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (depth > max) return true;
    if (item && typeof item === 'object') for (const child of Object.values(item)) if (child && typeof child === 'object') stack.push([child, depth + 1]);
  }
  return false;
}

// True when the text ends inside a string or with unclosed brackets; independent of engine error messages.
function looksTruncated(text) {
  let depth = 0, inString = false, escaped = false;
  for (const char of text) {
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
  }
  return inString || depth > 0;
}

/** Parses text or accepts an object; reports parse diagnostics. */
export function parseInput(input, limits, out) {
  if (typeof input === 'string') {
    let text = input;
    if (new TextEncoder().encode(text).length > limits.maxBytes) { out.add({ code: 'INPUT_TOO_LARGE', path: '', message: `Input exceeds ${limits.maxBytes} bytes.`, expected: { maxBytes: limits.maxBytes } }); return undefined; }
    if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); out.add({ code: 'BYTE_ORDER_MARK', path: '', message: 'Input starts with a byte order mark.', autofix: { rule: 'strip-byte-order-mark' } }); }
    const fence = FENCE.exec(text);
    if (fence) { text = fence[1]; out.add({ code: 'MARKDOWN_FENCE', path: '', message: 'The JSON is wrapped in a Markdown code fence.', suggestion: 'Return the JSON object only.', autofix: { rule: 'strip-markdown-fence' } }); }
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) {
      const incomplete = looksTruncated(text);
      out.add({ code: incomplete ? 'PARSE_INCOMPLETE' : 'PARSE_ERROR', path: '', message: incomplete ? 'The JSON ends early; the output was probably truncated.' : `Malformed JSON: ${error.message}`, suggestion: incomplete ? 'Regenerate the complete document; truncated output is never repaired automatically.' : 'Return a single valid JSON object.' });
      return undefined;
    }
    input = parsed;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) { out.add({ code: 'INPUT_UNSUPPORTED', path: '', message: `Expected a JSON object or JSON text, got ${describe(input)}.` }); return undefined; }
  if (tooDeep(input, limits)) { out.add({ code: 'LIMIT_DEPTH', path: '', message: `Input nests deeper than the protocol allows (${limits.maxDepth} component levels).` }); return undefined; }
  let size;
  try { size = new TextEncoder().encode(JSON.stringify(input)).length; } catch { out.add({ code: 'INPUT_UNSUPPORTED', path: '', message: 'Input is not JSON serializable.' }); return undefined; }
  if (size > limits.maxBytes) { out.add({ code: 'INPUT_TOO_LARGE', path: '', message: `Input exceeds ${limits.maxBytes} bytes.`, expected: { maxBytes: limits.maxBytes } }); return undefined; }
  return input;
}

/**
 * Validates a candidate (object or JSON text) against a contract.
 * Valid results carry `document`; invalid results carry `candidate` so the two can never be confused.
 */
export function validate(input, { contract = standardContract(), extensionValidators = {} } = {}) {
  const limits = contract.limits;
  const out = new Collector(limits.maxDiagnostics);
  const value = parseInput(input, limits, out);
  if (value === undefined) return finish(out, undefined, contract);
  const doc = structuredClone(value);
  checkDocument(doc, contract, extensionValidators, out);
  return finish(out, doc, contract);
}

function finish(out, doc, contract) {
  const diagnostics = out.items;
  const valid = doc !== undefined && !diagnostics.some(d => d.severity === 'error');
  return valid
    ? { valid: true, document: doc, diagnostics, truncated: false, contractId: contract.id }
    : { valid: false, candidate: doc, diagnostics, truncated: out.truncated, contractId: contract.id };
}

export function checkDocument(doc, contract, extensionValidators, out) {
  const limits = contract.limits;
  if (typeof doc.schemaVersion === 'string' && /^\d+\.\d+$/.test(doc.schemaVersion)) {
    const [major, minor] = doc.schemaVersion.split('.').map(Number), [cMajor, cMinor] = contract.protocolVersion.split('.').map(Number);
    if (major !== cMajor || minor > cMinor) out.add({ code: 'UNSUPPORTED_PROTOCOL_VERSION', path: '/schemaVersion', message: `Protocol ${doc.schemaVersion} is not supported by this contract.`, expected: { schemaVersion: contract.protocolVersion } });
  }
  if (!validators.document(doc)) ajvDiagnostics(validators.document.errors, [], doc, out);
  const datasets = doc.datasets && typeof doc.datasets === 'object' && !Array.isArray(doc.datasets) ? doc.datasets : {};
  if (Object.keys(datasets).length > limits.maxDatasets) out.add({ code: 'LIMIT_DATASETS', path: '/datasets', message: `At most ${limits.maxDatasets} datasets are allowed.` });
  for (const [name, dataset] of Object.entries(datasets)) {
    if (UNSAFE_KEYS.has(name)) out.add({ code: 'UNSAFE_KEY', path: pointer(['datasets', name]), message: `Dataset name ${name} is not allowed.` });
    const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
    if (rows.length > limits.maxDatasetRows) out.add({ code: 'LIMIT_DATASET_ROWS', path: pointer(['datasets', name, 'rows']), message: `At most ${limits.maxDatasetRows} rows are allowed.` });
    rows.slice(0, limits.maxDatasetRows).forEach((row, i) => { for (const key of Object.keys(row || {})) if (UNSAFE_KEYS.has(key)) out.add({ code: 'UNSAFE_KEY', path: pointer(['datasets', name, 'rows', i, key]), message: `Field name ${key} is not allowed.` }); });
  }
  if (!doc.root || typeof doc.root !== 'object' || Array.isArray(doc.root)) return;

  const ids = new Map(), bindings = new Map(), conditions = [], tables = [], actionsUsed = [], usedDatasets = new Set(), forms = [];
  let count = 0;
  const stack = [{ node: doc.root, path: ['root'], depth: 1, form: null }];
  while (stack.length && !out.full) {
    const { node, path, depth, form } = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node)) { out.add({ code: 'WRONG_TYPE', path: pointer(path), message: `Expected a component object, got ${describe(node)}.`, expected: { type: ['object'] } }); continue; }
    if (++count > limits.maxComponents) { out.add({ code: 'LIMIT_COMPONENTS', path: pointer(path), message: `Documents may contain at most ${limits.maxComponents} components; traversal stopped here.` }); out.truncated = true; break; }
    if (depth > limits.maxDepth) { out.add({ code: 'LIMIT_DEPTH', path: pointer(path), message: `Components may nest at most ${limits.maxDepth} levels; children below this point were not checked.` }); continue; }
    const type = node.type;
    if (typeof type !== 'string') { out.add({ code: 'MISSING_PROPERTY', path: pointer([...path, 'type']), message: 'Every component needs a type.', expected: { property: 'type' } }); continue; }
    const spec = contract.components[type];
    if (!spec) {
      const alias = catalog.aliases[type];
      if (catalog.components[type]) out.add({ code: 'COMPONENT_UNAVAILABLE', path: pointer([...path, 'type']), message: `${type} is a standard component but this host does not enable it.`, expected: { allowed: Object.keys(contract.components) } });
      else if (alias && alias.type === null) out.add({ code: 'UNKNOWN_COMPONENT', path: pointer([...path, 'type']), message: `${type} is not supported: the protocol has no raw markup, script or application component.`, suggestion: 'Express the content with standard components such as Text, Stack and Card.', expected: { allowed: Object.keys(contract.components) } });
      else if (alias && contract.components[alias.type]) {
        const patch = [{ op: 'replace', path: pointer([...path, 'type']), value: alias.type }, ...Object.entries(alias.set || {}).map(([key, value]) => ({ op: 'add', path: pointer([...path, key]), value }))];
        out.add({ code: 'UNKNOWN_COMPONENT', path: pointer([...path, 'type']), message: `Unknown component ${type}.`, suggestion: `Use ${alias.type}${alias.set ? ` with ${JSON.stringify(alias.set)}` : ''}, then check that every property is valid for ${alias.type}.`, alternatives: [alias.type], proposedPatch: patch, preconditions: [`all other properties are valid for ${alias.type}`] });
      } else {
        const close = nearest(type, Object.keys(contract.components), 3);
        out.add({ code: 'UNKNOWN_COMPONENT', path: pointer([...path, 'type']), message: `Unknown component ${type}.`, expected: { allowed: Object.keys(contract.components) }, ...(close.length ? { alternatives: close, suggestion: `Did you mean ${close.join(' or ')}?` } : {}) });
      }
      continue;
    }
    const validator = spec.extension ? extensionValidators[type] : validators[type];
    if (validator && !validator(node)) ajvDiagnostics(validator.errors, path, node, out);
    if (typeof node.id === 'string') {
      if (ids.has(node.id)) out.add({ code: 'DUPLICATE_ID', path: pointer([...path, 'id']), message: `Component id ${node.id} is already used at ${ids.get(node.id)}.`, suggestion: 'Give each component a unique id.' });
      else ids.set(node.id, pointer(path));
    }
    scanStrings(node, path, limits.maxStringLength, out);
    if (node.visibleWhen && typeof node.visibleWhen === 'object') conditions.push({ condition: node.visibleWhen, path: [...path, 'visibleWhen'] });
    const kind = bindingKind(node, spec);
    if (kind && typeof node.bind === 'string') {
      if (UNSAFE_KEYS.has(node.bind)) out.add({ code: 'UNSAFE_KEY', path: pointer([...path, 'bind']), message: `Binding ${node.bind} is not allowed.` });
      else if (bindings.has(node.bind)) out.add({ code: 'DUPLICATE_BINDING', path: pointer([...path, 'bind']), message: `Field ${node.bind} is already bound at ${pointer(bindings.get(node.bind).path)}.`, suggestion: 'Each bind key belongs to exactly one input component.' });
      else bindings.set(node.bind, { node, path, kind, form });
    }
    checkComponent(node, path, form, out, { tables, actionsUsed, forms, usedDatasets });
    const childForm = type === 'Form' ? { node, path, hasSubmit: false } : form;
    if (type === 'Form') { if (form) out.add({ code: 'NESTED_FORM', path: pointer(path), message: `Forms cannot nest; this form is inside ${pointer(form.path)}.` }); forms.push(childForm); }
    if (type === 'Button' && node.action?.type === 'submit' && form) form.hasSubmit = true;
    const children = [];
    for (const slot of spec.slots || []) {
      if (slot === 'children' && Array.isArray(node.children)) node.children.forEach((child, i) => children.push({ node: child, path: [...path, 'children', i] }));
      if (slot === 'tabs/*/children' && Array.isArray(node.tabs)) node.tabs.forEach((tab, t) => Array.isArray(tab?.children) && tab.children.forEach((child, i) => children.push({ node: child, path: [...path, 'tabs', t, 'children', i] })));
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push({ ...children[i], depth: depth + 1, form: childForm });
  }
  for (const form of forms) if (!form.hasSubmit) out.add({ code: 'FORM_WITHOUT_SUBMIT', severity: 'warning', path: pointer(form.path), message: 'This form has no submit button; Enter in a text field still submits it.' });
  for (const { condition, path } of conditions) checkCondition(condition, path, bindings, out);
  for (const { node, path } of tables) (node.type === 'Chart' ? checkChart : checkTable)(node, path, datasets, out);
  for (const name of Object.keys(datasets)) if (!usedDatasets.has(name)) out.add({ code: 'UNUSED_DATASET', severity: 'warning', path: pointer(['datasets', name]), message: `Dataset ${name} is not used by any Table or Chart.` });
  checkActions(actionsUsed, contract, out);
  checkPolicy(doc.root, contract, out);
}

function scanStrings(node, path, max, out) {
  const visit = (value, at) => {
    if (typeof value === 'string') { if (value.length > max) out.add({ code: 'LIMIT_STRING_LENGTH', path: pointer(at), message: `Strings may contain at most ${max} characters.` }); }
    else if (Array.isArray(value)) value.forEach((item, i) => visit(item, [...at, i]));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (key !== 'children') visit(item, [...at, key]);
  };
  visit(node, path);
}

function checkComponent(node, path, form, out, context) {
  const at = (...parts) => pointer([...path, ...parts]);
  switch (node.type) {
    case 'Input': {
      const kind = node.kind ?? 'text', number = kind === 'number';
      if (node.multiline === true && kind !== 'text') out.add({ code: 'PROPERTY_NOT_APPLICABLE', path: at('multiline'), message: 'multiline only applies to kind text.' });
      for (const prop of ['min', 'max', 'step']) if (node[prop] !== undefined && !number) out.add({ code: 'PROPERTY_NOT_APPLICABLE', path: at(prop), message: `${prop} only applies to kind number.` });
      for (const prop of ['minLength', 'maxLength']) if (node[prop] !== undefined && number) out.add({ code: 'PROPERTY_NOT_APPLICABLE', path: at(prop), message: `${prop} does not apply to kind number.` });
      if (typeof node.min === 'number' && typeof node.max === 'number' && node.min > node.max) out.add({ code: 'INVALID_RANGE', path: at('min'), message: 'min must not exceed max.' });
      if (Number.isInteger(node.minLength) && Number.isInteger(node.maxLength) && node.minLength > node.maxLength) out.add({ code: 'INVALID_RANGE', path: at('minLength'), message: 'minLength must not exceed maxLength.' });
      if (node.default !== undefined) {
        const d = node.default;
        if (number ? !(d === null || (typeof d === 'number' && Number.isFinite(d))) : typeof d !== 'string') out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: number ? 'A number input default must be a number or null.' : 'This input stores a string; the default must be a string.' });
        else if (number && typeof d === 'number' && ((typeof node.min === 'number' && d < node.min) || (typeof node.max === 'number' && d > node.max))) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'The default is outside min and max.' });
        else if (kind === 'date' && d && !DATE.test(d)) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'Date defaults use YYYY-MM-DD.' });
        else if (kind === 'time' && d && !TIME.test(d)) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'Time defaults use HH:MM.' });
      }
      break;
    }
    case 'Choice': {
      const options = Array.isArray(node.options) ? node.options : [], values = new Set();
      options.forEach((option, i) => { if (option && typeof option.value === 'string') { if (values.has(option.value)) out.add({ code: 'DUPLICATE_OPTION_VALUE', path: at('options', i, 'value'), message: `Option value ${option.value} is repeated.` }); values.add(option.value); } });
      const multiple = node.mode === 'multiple';
      if (node.display === 'radio' && multiple) out.add({ code: 'INVALID_DISPLAY', path: at('display'), message: 'radio display only supports mode single.', suggestion: 'Use checkbox, buttons or select for multiple selection.' });
      if (node.display === 'checkbox' && node.mode === 'single') out.add({ code: 'INVALID_DISPLAY', path: at('display'), message: 'checkbox display only supports mode multiple.', suggestion: 'Use radio, buttons or select for single selection.' });
      for (const prop of ['minSelected', 'maxSelected']) if (node[prop] !== undefined && node.mode === 'single') out.add({ code: 'PROPERTY_NOT_APPLICABLE', path: at(prop), message: `${prop} only applies to mode multiple.` });
      if (multiple && Number.isInteger(node.minSelected) && Number.isInteger(node.maxSelected) && node.minSelected > node.maxSelected) out.add({ code: 'INVALID_RANGE', path: at('minSelected'), message: 'minSelected must not exceed maxSelected.' });
      if (multiple && Number.isInteger(node.minSelected) && node.minSelected > options.length) out.add({ code: 'INVALID_RANGE', path: at('minSelected'), message: 'minSelected exceeds the number of options.' });
      if (node.default !== undefined) {
        if (multiple) {
          if (!Array.isArray(node.default)) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'A multiple choice default must be an array of option values.' });
          else node.default.forEach((value, i) => { if (!values.has(value)) out.add({ code: 'INVALID_DEFAULT', path: at('default', i), message: `${JSON.stringify(value)} is not an option value.`, expected: { allowed: [...values] } }); });
          if (Array.isArray(node.default) && new Set(node.default).size !== node.default.length) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'Default values must be unique.' });
        } else if (node.mode === 'single') {
          if (typeof node.default !== 'string') out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'A single choice default must be one option value.' });
          else if (node.default !== '' && !values.has(node.default)) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: `${JSON.stringify(node.default)} is not an option value.`, expected: { allowed: [...values] } });
        }
      }
      break;
    }
    case 'Slider': {
      const { min, max } = node, step = node.step ?? 1;
      if (typeof min === 'number' && typeof max === 'number') {
        if (min >= max) out.add({ code: 'INVALID_BOUNDS', path: at('max'), message: 'max must be greater than min.' });
        else if (typeof step === 'number' && step > max - min) out.add({ code: 'INVALID_BOUNDS', path: at('step'), message: 'step must not exceed max - min.' });
        if (typeof node.default === 'number' && (node.default < min || node.default > max)) out.add({ code: 'INVALID_DEFAULT', path: at('default'), message: 'The default is outside min and max.' });
      }
      break;
    }
    case 'Form':
      if (typeof node.submitAction === 'string') context.actionsUsed.push({ id: node.submitAction, path: [...path, 'submitAction'], use: 'form' });
      break;
    case 'Button': {
      const action = node.action;
      if (!action || typeof action !== 'object') break;
      if (action.type === 'action') {
        if (typeof action.actionId !== 'string') out.add({ code: 'MISSING_PROPERTY', path: at('action', 'actionId'), message: 'Host actions need an actionId.', expected: { property: 'actionId' } });
        else context.actionsUsed.push({ id: action.actionId, path: [...path, 'action', 'actionId'], use: 'button' });
      } else if (action.type === 'submit' || action.type === 'reset') {
        if (action.actionId !== undefined) out.add({ code: 'PROPERTY_NOT_APPLICABLE', path: at('action', 'actionId'), message: `${action.type} buttons use the form's submitAction; remove actionId.` });
        if (!form) out.add({ code: 'BUTTON_OUTSIDE_FORM', path: at('action'), message: `A ${action.type} button must be inside a Form.`, suggestion: 'Move the button into the Form, or use {"type":"action","actionId":"..."}.' });
      }
      break;
    }
    case 'Tabs': {
      const tabs = Array.isArray(node.tabs) ? node.tabs : [], seen = new Set();
      tabs.forEach((tab, i) => { if (typeof tab?.id === 'string') { if (seen.has(tab.id)) out.add({ code: 'DUPLICATE_TAB_ID', path: at('tabs', i, 'id'), message: `Tab id ${tab.id} is repeated.` }); seen.add(tab.id); } });
      if (typeof node.defaultTab === 'string' && !seen.has(node.defaultTab)) out.add({ code: 'UNKNOWN_TAB', path: at('defaultTab'), message: `No tab has id ${node.defaultTab}.`, expected: { allowed: [...seen] } });
      break;
    }
    case 'Chart':
    case 'Table':
      context.tables.push({ node, path });
      if (typeof node.dataset === 'string') context.usedDatasets.add(node.dataset);
      break;
  }
}

function checkCondition(condition, path, bindings, out) {
  const at = (...parts) => pointer([...path, ...parts]);
  const binding = bindings.get(condition.bind);
  if (typeof condition.bind === 'string' && !binding) { out.add({ code: 'UNKNOWN_BINDING', path: at('bind'), message: `No input component binds ${condition.bind}.`, expected: { allowed: [...bindings.keys()] } }); return; }
  const op = condition.op, has = condition.value !== undefined;
  if ((op === 'empty' || op === 'notEmpty') && has) out.add({ code: 'INVALID_CONDITION', path: at('value'), message: `${op} takes no value.` });
  if ((op === 'equals' || op === 'notEquals') && (!has || Array.isArray(condition.value))) out.add({ code: 'INVALID_CONDITION', path: at('value'), message: `${op} needs a scalar value.` });
  if (op === 'in' && !Array.isArray(condition.value)) out.add({ code: 'INVALID_CONDITION', path: at('value'), message: 'in needs an array value.' });
  if (!binding || !has) return;
  const scalar = { string: 'string', 'string[]': 'string', number: 'number', boolean: 'boolean' }[binding.kind];
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  if (values.some(value => typeof value !== scalar)) out.add({ code: 'INVALID_CONDITION', path: at('value'), message: `${condition.bind} stores ${binding.kind}; compare it with ${scalar} values.` });
}

function checkChart(node, path, datasets, out) {
  const at = (...parts) => pointer([...path, ...parts]);
  const series = Array.isArray(node.series) ? node.series : [];
  if (node.kind === 'pie' && series.length !== 1) out.add({ code: 'INVALID_CHART_SERIES', path: at('series'), message: 'Pie charts require exactly one series.' });
  const seen = new Set();
  for (const [i, item] of series.entries()) {
    if (typeof item?.field !== 'string') continue;
    if (seen.has(item.field)) out.add({ code: 'DUPLICATE_SERIES', path: at('series', i, 'field'), message: `Series field ${item.field} is repeated.` });
    seen.add(item.field);
  }
  if (typeof node.dataset !== 'string') return;
  const dataset = Object.hasOwn(datasets, node.dataset) ? datasets[node.dataset] : undefined;
  if (!dataset) { out.add({ code: 'UNKNOWN_DATASET', path: at('dataset'), message: `No dataset named ${node.dataset}.`, expected: { allowed: Object.keys(datasets) } }); return; }
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const mappings = [{ field: node.x, category: true }, ...series.filter(item => typeof item?.field === 'string')];
  for (const { field, category } of mappings) {
    if (typeof field !== 'string') continue;
    const bad = rows.findIndex(row => {
      const value = row && Object.hasOwn(row, field) ? row[field] : undefined;
      return category ? !(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
        : value !== null && !(typeof value === 'number' && Number.isFinite(value) && (node.kind !== 'pie' || value >= 0));
    });
    if (bad >= 0) out.add({ code: 'INVALID_DATASET_VALUE', path: pointer(['datasets', node.dataset, 'rows', bad, field]), message: category
      ? `Chart category ${field} must be present and contain a string or finite number.`
      : `Chart series ${field} must be present and contain a finite number or null${node.kind === 'pie' ? '; pie values must be nonnegative' : ''}.` });
  }
}

function checkTable(node, path, datasets, out) {
  const at = (...parts) => pointer([...path, ...parts]);
  if (typeof node.dataset !== 'string') return;
  const dataset = Object.hasOwn(datasets, node.dataset) ? datasets[node.dataset] : undefined;
  if (!dataset) { out.add({ code: 'UNKNOWN_DATASET', path: at('dataset'), message: `No dataset named ${node.dataset}.`, expected: { allowed: Object.keys(datasets) } }); return; }
  const columns = Array.isArray(node.columns) ? node.columns : [], fields = new Set();
  columns.forEach((column, i) => { if (typeof column?.field === 'string') { if (fields.has(column.field)) out.add({ code: 'DUPLICATE_COLUMN', path: at('columns', i, 'field'), message: `Column ${column.field} is repeated.` }); fields.add(column.field); } });
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  for (const [i, column] of columns.entries()) {
    if (column?.format !== 'number') continue;
    const bad = rows.findIndex(row => row && row[column.field] !== undefined && row[column.field] !== null && typeof row[column.field] !== 'number');
    if (bad >= 0) out.add({ code: 'INVALID_DATASET_VALUE', path: pointer(['datasets', node.dataset, 'rows', bad, column.field]), message: `Column ${column.field} is formatted as number; values must be numbers or null.`, expected: { column: at('columns', i) } });
  }
  if (typeof node.rowKey === 'string') {
    const seen = new Set();
    for (const [i, row] of rows.entries()) {
      const key = row?.[node.rowKey];
      if (key === undefined || key === null) { out.add({ code: 'MISSING_ROW_KEY', path: pointer(['datasets', node.dataset, 'rows', i]), message: `Row has no ${node.rowKey} value.` }); break; }
      if (seen.has(key)) { out.add({ code: 'DUPLICATE_ROW_KEY', path: pointer(['datasets', node.dataset, 'rows', i, node.rowKey]), message: `${node.rowKey} ${JSON.stringify(key)} is repeated.` }); break; }
      seen.add(key);
    }
  }
}

function checkActions(used, contract, out) {
  if (!used.length) return;
  if (contract.actions === null) { out.add({ code: 'ACTIONS_NOT_VERIFIED', severity: 'info', path: '', message: 'This contract does not list actions; action ids are verified against the deployment contract at publication.' }); return; }
  const registered = new Map(contract.actions.map(action => [action.id, action]));
  for (const { id, path, use } of used) {
    const action = registered.get(id);
    if (!action) {
      const close = nearest(id, [...registered.keys()], 4);
      out.add({ code: 'UNREGISTERED_ACTION', path: pointer(path), message: 'The action is not registered by this host.', expected: { allowed: [...registered.keys()] }, suggestion: registered.size ? 'Use a registered action that matches the intended operation, or remove the action.' : 'This host registers no actions; remove the action.', ...(close.length ? { alternatives: close } : {}) });
    } else if ((use === 'form' && action.input === 'none') || (use === 'button' && action.input === 'form')) {
      out.add({ code: 'ACTION_INPUT_MISMATCH', path: pointer(path), message: use === 'form' ? `${id} does not accept form values; use it from a Button action.` : `${id} expects form values; use it as a Form submitAction.` });
    }
  }
}

function checkPolicy(root, contract, out) {
  const resources = { Image: ['src', 'image'], Link: ['href', 'link'], WebPreview: ['url', 'webPreview'] };
  const stack = [[root, ['root']]];
  let seen = 0;
  while (stack.length && seen++ < contract.limits.maxComponents && !out.full) {
    const [node, path] = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const resource = resources[node.type];
    if (resource && typeof node[resource[0]] === 'string') {
      const problem = checkUrl(node[resource[0]], resource[1], contract.policy);
      if (problem) out.add({ ...problem, path: pointer([...path, resource[0]]) });
    }
    if (Array.isArray(node.children)) node.children.forEach((child, i) => stack.push([child, [...path, 'children', i]]));
    if (Array.isArray(node.tabs)) node.tabs.forEach((tab, t) => Array.isArray(tab?.children) && tab.children.forEach((child, i) => stack.push([child, [...path, 'tabs', t, 'children', i]])));
  }
}
