import * as validators from './validators.mjs';
import { catalog } from './catalog.mjs';
import { bindingKind } from './validate.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const MAX_ARCHIVED = 1000;

export const emptyValue = kind => ({ string: '', number: null, boolean: false, 'string[]': [] })[kind];

/** Walks components in document order, calling visit(node, context) with the enclosing form and visibility chain. */
export function walk(document, visit) {
  const stack = [{ node: document?.root, form: null, conditions: [] }];
  while (stack.length) {
    const { node, form, conditions } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const own = node.visibleWhen ? [...conditions, node.visibleWhen] : conditions;
    visit(node, { form, conditions: own });
    const childForm = node.type === 'Form' ? node : form;
    const children = [];
    if (Array.isArray(node.children)) children.push(...node.children);
    if (Array.isArray(node.tabs)) for (const tab of node.tabs) if (Array.isArray(tab?.children)) children.push(...tab.children);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], form: childForm, conditions: own });
  }
}

/** Map of bind key to { kind, node, form, conditions, options }. */
export function fieldsOf(document) {
  const fields = new Map();
  walk(document, (node, { form, conditions }) => {
    const kind = catalog.components[node.type] ? bindingKind(node) : null;
    if (!kind || typeof node.bind !== 'string' || fields.has(node.bind)) return;
    fields.set(node.bind, { kind, node, form, conditions, options: node.type === 'Choice' && Array.isArray(node.options) ? new Set(node.options.map(o => o.value)) : null });
  });
  return fields;
}

export function defaultValue(field) {
  const { node, kind } = field;
  if (node.type === 'Slider') return typeof node.default === 'number' ? node.default : node.min;
  if (node.default !== undefined) return structuredClone(node.default);
  return emptyValue(kind);
}

/** Checks that a value has the field's type and only uses current options. */
export function valueFits(field, value) {
  switch (field.kind) {
    case 'string': return typeof value === 'string' && (!field.options || value === '' || field.options.has(value));
    case 'number': return value === null || (typeof value === 'number' && Number.isFinite(value));
    case 'boolean': return typeof value === 'boolean';
    case 'string[]': return Array.isArray(value) && value.every(v => typeof v === 'string' && (!field.options || field.options.has(v))) && new Set(value).size === value.length;
  }
  return false;
}
const sameShape = (field, value) => field.kind === 'string[]' ? Array.isArray(value) && value.every(v => typeof v === 'string') : field.kind === 'number' ? value === null || typeof value === 'number' : typeof value === field.kind;

export function evaluateCondition(condition, values) {
  const value = values[condition.bind];
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  switch (condition.op) {
    case 'empty': return empty;
    case 'notEmpty': return !empty;
    case 'equals': return Array.isArray(value) ? value.includes(condition.value) : value === condition.value;
    case 'notEquals': return Array.isArray(value) ? !value.includes(condition.value) : value !== condition.value;
    case 'in': return Array.isArray(condition.value) && (Array.isArray(value) ? value.some(v => condition.value.includes(v)) : condition.value.includes(value));
  }
  return false;
}
export const isVisible = (conditions, values) => conditions.every(condition => evaluateCondition(condition, values));

/** Local constraint check for one field. Returns null or { code, limit }. */
export function checkField(field, value) {
  const { node, kind } = field;
  if (!valueFits(field, value)) return { code: 'invalid' };
  if (kind === 'string') {
    if (node.required && value === '') return { code: 'required' };
    if (value === '') return null;
    if (node.type === 'Input') {
      if (Number.isInteger(node.minLength) && value.length < node.minLength) return { code: 'tooShort', limit: node.minLength };
      if (Number.isInteger(node.maxLength) && value.length > node.maxLength) return { code: 'tooLong', limit: node.maxLength };
      if (node.kind === 'email' && !EMAIL.test(value)) return { code: 'invalidEmail' };
      if (node.kind === 'url') { try { if (!/^https?:$/.test(new URL(value).protocol)) return { code: 'invalidUrl' }; } catch { return { code: 'invalidUrl' }; } }
      if (node.kind === 'date' && !DATE.test(value)) return { code: 'invalidDate' };
      if (node.kind === 'time' && !TIME.test(value)) return { code: 'invalidTime' };
    }
  }
  if (kind === 'number') {
    if (value === null) return node.required ? { code: 'required' } : null;
    if (typeof node.min === 'number' && value < node.min) return { code: 'tooSmall', limit: node.min };
    if (typeof node.max === 'number' && value > node.max) return { code: 'tooLarge', limit: node.max };
  }
  if (kind === 'string[]') {
    const min = Number.isInteger(node.minSelected) ? node.minSelected : node.required ? 1 : 0;
    if (value.length < min) return { code: value.length ? 'selectAtLeast' : 'required', limit: min };
    if (Number.isInteger(node.maxSelected) && value.length > node.maxSelected) return { code: 'selectAtMost', limit: node.maxSelected };
  }
  return null;
}

export function initialState(document, state) {
  const fields = fieldsOf(document);
  const values = {}, dirty = [];
  for (const [bind, field] of fields) {
    const given = state?.values?.[bind];
    values[bind] = given !== undefined && valueFits(field, given) ? structuredClone(given) : defaultValue(field);
    if (state?.dirty?.includes(bind) && given !== undefined && valueFits(field, given)) dirty.push(bind);
  }
  return { values, dirty, archived: structuredClone(state?.archived || []) };
}

/**
 * Three way merge of field state when a new document revision arrives.
 * previous: the document the local state belongs to (or null); next: the incoming document;
 * local: { values, dirty, archived } edited by the user; incoming: optional committed state from the host.
 * Dirty bindings are user owned: new defaults never replace them.
 */
export function mergeState({ previous = null, next, local, incoming, reset = [], revision = 0 }) {
  const before = previous ? fieldsOf(previous) : new Map(), after = fieldsOf(next);
  const localValues = local?.values || {}, localDirty = new Set(local?.dirty || []);
  const incomingValues = incoming?.values || {}, incomingDirty = new Set(incoming?.dirty || []);
  const values = {}, dirty = new Set(), archived = [...(incoming?.archived || local?.archived || [])], outcomes = [];
  const resets = new Set(reset);
  const archive = (bind, value, reason) => archived.push({ bind, value: structuredClone(value), revision, reason });
  for (const [bind, field] of after) {
    const fallback = () => Object.hasOwn(incomingValues, bind) && valueFits(field, incomingValues[bind]) ? structuredClone(incomingValues[bind]) : defaultValue(field);
    if (resets.has(bind)) { values[bind] = defaultValue(field); outcomes.push({ bind, outcome: 'reset' }); continue; }
    if (localDirty.has(bind) && Object.hasOwn(localValues, bind)) {
      const value = localValues[bind], old = before.get(bind);
      if ((old && old.kind !== field.kind) || !sameShape(field, value)) {
        archive(bind, value, 'type-changed');
        values[bind] = defaultValue(field);
        outcomes.push({ bind, outcome: 'type-changed', from: old?.kind, to: field.kind });
        continue;
      }
      if (field.options && !valueFits(field, value)) {
        const removed = (Array.isArray(value) ? value : [value]).filter(v => !field.options.has(v));
        archive(bind, value, 'value-removed');
        values[bind] = Array.isArray(value) ? value.filter(v => field.options.has(v)) : '';
        dirty.add(bind);
        outcomes.push({ bind, outcome: 'value-removed', removed });
        continue;
      }
      values[bind] = structuredClone(value); dirty.add(bind);
      continue;
    }
    if (incomingDirty.has(bind) && Object.hasOwn(incomingValues, bind) && valueFits(field, incomingValues[bind])) { values[bind] = structuredClone(incomingValues[bind]); dirty.add(bind); continue; }
    values[bind] = fallback();
  }
  for (const bind of localDirty) {
    if (!after.has(bind) && Object.hasOwn(localValues, bind)) { archive(bind, localValues[bind], 'removed'); outcomes.push({ bind, outcome: 'removed' }); }
  }
  return { state: { values, dirty: [...dirty], archived: archived.slice(-MAX_ARCHIVED) }, outcomes };
}

/**
 * Host side commit: wraps a validated candidate with identity, revision and merged state.
 * Pass the previous committed document and the latest stored state so user input carries forward.
 */
export function commitDocument(candidate, { id, revision, previous = null, state, reset, contractId } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id || '')) throw new TypeError('commitDocument needs a document id');
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('revision must be a positive integer');
  const local = state ?? previous?.state;
  const { state: merged, outcomes } = previous || local
    ? mergeState({ previous: previous?.document ?? null, next: candidate, local, reset, revision })
    : { state: initialState(candidate), outcomes: [] };
  return { committed: { id, revision, ...(contractId ? { contractId } : {}), document: structuredClone(candidate), state: merged }, outcomes };
}

/** Checks a state object saved by a client against the committed document. Returns a list of problems. */
export function checkState(document, state) {
  if (!validators.state(state)) return validators.state.errors.map(error => ({ code: 'INVALID_STATE', path: error.instancePath, message: error.message }));
  const fields = fieldsOf(document), problems = [];
  for (const [bind, value] of Object.entries(state.values)) {
    const field = fields.get(bind);
    if (!field) problems.push({ code: 'UNKNOWN_BINDING', path: `/values/${bind}`, message: `No field ${bind} in this document.` });
    else if (!valueFits(field, value)) problems.push({ code: 'INVALID_VALUE', path: `/values/${bind}`, message: `Value does not fit ${bind} (${field.kind}).` });
  }
  for (const bind of state.dirty) if (!fields.has(bind)) problems.push({ code: 'UNKNOWN_BINDING', path: '/dirty', message: `No field ${bind} in this document.` });
  return problems;
}

/** Fields a form submits for the given values: visible bindings inside the form. */
export function formFields(document, formId, values) {
  const result = [];
  for (const [bind, field] of fieldsOf(document)) if (field.form?.id === formId && isVisible(field.conditions, values)) result.push([bind, field]);
  return result;
}

/**
 * Host side re-validation of an interaction event against the committed revision it names.
 * Returns { ok: true, event } or { ok: false, status, code, message, problems }.
 */
export function checkEvent(committed, event, { state } = {}) {
  if (!validators.event(event)) return { ok: false, status: 400, code: 'INVALID_EVENT', message: 'Malformed interaction event.', problems: validators.event.errors.map(e => ({ path: e.instancePath, message: e.message })) };
  if (event.documentId !== committed.id) return { ok: false, status: 400, code: 'WRONG_DOCUMENT', message: 'The event belongs to a different document.' };
  if (event.baseRevision !== committed.revision) return { ok: false, status: 409, code: 'STALE_REVISION', message: `The event was made on revision ${event.baseRevision}; the current revision is ${committed.revision}.` };
  let source;
  walk(committed.document, (node, context) => { if (node.id === event.sourceId) source = { node, ...context }; });
  if (!source) return { ok: false, status: 400, code: 'UNKNOWN_SOURCE', message: `No component ${event.sourceId}.` };
  const { node } = source;
  const form = node.type === 'Form' ? node : node.type === 'Button' && node.action?.type === 'submit' ? source.form : null;
  if (form) {
    if (event.actionId !== form.submitAction) return { ok: false, status: 400, code: 'ACTION_MISMATCH', message: `This form submits to ${form.submitAction}.` };
    const values = { ...(state?.values || committed.state.values), ...event.values };
    const allowed = new Map(formFields(committed.document, form.id, values));
    const problems = [];
    for (const bind of Object.keys(event.values)) if (!allowed.has(bind)) problems.push({ path: `/values/${bind}`, code: 'OUT_OF_SCOPE', message: `${bind} is not a visible field of form ${form.id}.` });
    for (const [bind, field] of allowed) {
      if (!Object.hasOwn(event.values, bind)) { problems.push({ path: `/values/${bind}`, code: 'MISSING_VALUE', message: `${bind} was not submitted.` }); continue; }
      const problem = checkField(field, event.values[bind]);
      if (problem) problems.push({ path: `/values/${bind}`, ...problem, message: `${bind}: ${problem.code}` });
    }
    if (problems.length) return { ok: false, status: 422, code: 'INVALID_VALUES', message: 'Submitted values do not match the form.', problems };
    return { ok: true, event, form };
  }
  if (node.type === 'Button' && node.action?.type === 'action') {
    if (event.actionId !== node.action.actionId) return { ok: false, status: 400, code: 'ACTION_MISMATCH', message: `This button runs ${node.action.actionId}.` };
    if (Object.keys(event.values).length) return { ok: false, status: 422, code: 'INVALID_VALUES', message: 'Button actions do not submit values.' };
    return { ok: true, event };
  }
  return { ok: false, status: 400, code: 'NOT_AN_ACTION_SOURCE', message: `${event.sourceId} does not run actions.` };
}
