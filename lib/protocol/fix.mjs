import { validate, parseInput } from './validate.mjs';
import { standardContract } from './contract.mjs';
import { repairFeedback } from './instructions.mjs';

const FENCE = /^\s*```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n\s*```\s*$/;

/** Deterministic repair rules. Each changes only representation, never meaning or user data. */
export const fixRules = Object.freeze({
  'strip-byte-order-mark': 'Removes a leading byte order mark before parsing.',
  'strip-markdown-fence': 'Removes one Markdown code fence that surrounds the whole JSON text.',
  'add-schema-version': 'Adds the contract protocol version when schemaVersion is missing.',
  'coerce-numeric-string': 'Converts a canonical decimal string to a number where the schema requires a number.',
  'coerce-boolean-string': 'Converts "true" or "false" to a boolean where the schema requires a boolean.',
  'normalize-enum-case': 'Replaces an enum value that differs from exactly one allowed value only by case or surrounding spaces.'
});

const unescape = part => part.replace(/~1/g, '/').replace(/~0/g, '~');
function setAt(root, path, value) {
  const parts = path.split('/').slice(1).map(unescape);
  const key = parts.pop();
  const parent = parts.reduce((node, part) => node?.[part], root);
  if (!parent || typeof parent !== 'object') return false;
  parent[key] = value;
  return true;
}
const getAt = (root, path) => path.split('/').slice(1).map(unescape).reduce((node, part) => node?.[part], root);

/**
 * Applies deterministic fixes to a detached copy and revalidates.
 * Returns the validation result plus every applied change; repeating fix() on the output changes nothing.
 */
export function fix(input, { contract = standardContract(), extensionValidators } = {}) {
  const applied = [];
  let value = input;
  if (typeof value === 'string') {
    if (value.charCodeAt(0) === 0xfeff) { value = value.slice(1); applied.push({ rule: 'strip-byte-order-mark', path: '', reason: fixRules['strip-byte-order-mark'], change: { op: 'text', description: 'removed U+FEFF' } }); }
    const fence = FENCE.exec(value);
    if (fence) { value = fence[1]; applied.push({ rule: 'strip-markdown-fence', path: '', reason: fixRules['strip-markdown-fence'], change: { op: 'text', description: 'removed surrounding code fence' } }); }
  }
  const collector = { add() {}, full: false, items: [] };
  const parsed = parseInput(value, contract.limits, collector);
  if (parsed === undefined) return { ...validate(value, { contract, extensionValidators }), applied };
  let candidate = structuredClone(parsed);
  for (let pass = 0; pass < 5; pass++) {
    const result = validate(candidate, { contract, extensionValidators });
    let changed = false;
    for (const diagnostic of result.diagnostics) {
      const rule = diagnostic.autofix?.rule;
      if (!rule) continue;
      if (rule === 'add-schema-version') {
        candidate.schemaVersion = contract.protocolVersion;
        applied.push({ rule, path: '/schemaVersion', reason: fixRules[rule], change: { op: 'add', path: '/schemaVersion', value: contract.protocolVersion } });
        changed = true;
      } else if (Object.hasOwn(diagnostic.autofix, 'value')) {
        const previous = getAt(candidate, diagnostic.path);
        if (setAt(candidate, diagnostic.path, diagnostic.autofix.value)) {
          applied.push({ rule, path: diagnostic.path, reason: fixRules[rule], change: { op: 'replace', path: diagnostic.path, value: diagnostic.autofix.value, previous } });
          changed = true;
        }
      }
    }
    if (!changed) return { ...result, applied };
  }
  return { ...validate(candidate, { contract, extensionValidators }), applied };
}

/**
 * Optional bounded model repair loop. `model` receives the rejected candidate and diagnostics and returns
 * a new candidate (object or JSON text). Deterministic fixes run before every attempt.
 */
export async function repair(input, { contract = standardContract(), model, maxAttempts = 2, signal, extensionValidators } = {}) {
  if (typeof model !== 'function') throw new TypeError('repair needs a model callback');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) throw new TypeError('maxAttempts must be an integer from 0 to 10');
  const history = [];
  let current = input;
  for (let attempt = 0; ; attempt++) {
    const result = fix(current, { contract, extensionValidators });
    history.push({ attempt, valid: result.valid, applied: result.applied, diagnostics: result.diagnostics });
    if (result.valid) return { ...result, attempts: attempt, history, status: 'valid' };
    if (attempt >= maxAttempts) return { ...result, attempts: attempt, history, status: 'max-attempts' };
    if (signal?.aborted) return { ...result, attempts: attempt, history, status: 'cancelled' };
    try {
      current = await model({ candidate: result.candidate, diagnostics: result.diagnostics, feedback: repairFeedback(result), attempt: attempt + 1, signal });
    } catch (error) {
      if (signal?.aborted) return { ...result, attempts: attempt, history, status: 'cancelled' };
      return { ...result, attempts: attempt, history, status: 'model-error', error };
    }
  }
}
