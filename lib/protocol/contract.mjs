import { catalog } from './catalog.mjs';

export const PROTOCOL_VERSION = catalog.protocolVersion;
export const PACKAGE_VERSION = catalog.packageVersion;
const SANDBOX_TOKENS = new Set(['allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-same-origin', 'allow-downloads', 'allow-presentation']);
const RESOURCES = ['image', 'link', 'webPreview'];
const actionPattern = new RegExp(catalog.patterns.action);
const extensionPattern = /^[a-z][a-z0-9-]{0,31}:[A-Z][a-zA-Z0-9]{0,63}$/;

/** Stable JSON with sorted keys, used for contract identity. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
// FNV-1a 64-bit: synchronous and identical in browsers and Node; identity only, not security.
export function fingerprint(text) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}
function normalizeOrigins(origins, where) {
  if (!Array.isArray(origins)) throw new TypeError(`${where}.origins must be an array`);
  return origins.map(origin => {
    if (origin === '*') return origin;
    const match = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(:\d+)?$/i.exec(origin);
    if (!match) throw new TypeError(`${where}.origins: invalid origin ${JSON.stringify(origin)}; use '*', 'https://host' or 'https://*.host'`);
    return origin.toLowerCase();
  });
}

/**
 * Builds a capability contract. With no arguments it returns the static standard profile,
 * where actions are not verified because only a deployment knows its registered actions.
 */
export function createContract({ components, actions = null, limits = {}, policy = {}, extensions = {} } = {}) {
  const types = components ?? Object.keys(catalog.components);
  if (!Array.isArray(types)) throw new TypeError('components must be an array of component types');
  for (const type of types) if (!catalog.components[type]) throw new TypeError(`Unknown standard component ${JSON.stringify(type)}`);
  let normalizedActions = null;
  if (actions !== null) {
    if (!Array.isArray(actions)) throw new TypeError('actions must be an array or null');
    const seen = new Set();
    normalizedActions = actions.map(action => {
      const entry = typeof action === 'string' ? { id: action } : { ...action };
      if (!actionPattern.test(entry.id || '')) throw new TypeError(`Invalid action id ${JSON.stringify(entry.id)}`);
      if (seen.has(entry.id)) throw new TypeError(`Duplicate action id ${entry.id}`);
      seen.add(entry.id);
      if (entry.input !== undefined && !['form', 'none', 'any'].includes(entry.input)) throw new TypeError(`Action ${entry.id}: input must be form, none or any`);
      return { id: entry.id, ...(entry.description ? { description: String(entry.description) } : {}), input: entry.input || 'any' };
    });
  }
  const mergedLimits = { ...catalog.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in mergedLimits)) throw new TypeError(`Unknown limit ${key}`);
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`Limit ${key} must be a positive integer`);
    mergedLimits[key] = value;
  }
  if (mergedLimits.maxBytes > 4 * 1024 * 1024) throw new TypeError('maxBytes cannot exceed 4 MB');
  const urls = {};
  for (const resource of RESOURCES) {
    const base = catalog.policy.urls[resource], override = policy.urls?.[resource] || {};
    const schemes = override.schemes ?? base.schemes;
    if (!Array.isArray(schemes) || schemes.some(s => !/^[a-z][a-z0-9+.-]*$/.test(s) || ['javascript', 'vbscript', 'file'].includes(s))) throw new TypeError(`policy.urls.${resource}.schemes is invalid`);
    if (resource !== 'link' && schemes.some(s => !['https', 'http', 'data'].includes(s))) throw new TypeError(`policy.urls.${resource} only supports http, https and data`);
    urls[resource] = { schemes: [...schemes], origins: normalizeOrigins(override.origins ?? base.origins, `policy.urls.${resource}`) };
  }
  const sandbox = policy.webPreview?.sandbox ?? catalog.policy.webPreview.sandbox;
  if (!Array.isArray(sandbox) || sandbox.some(token => !SANDBOX_TOKENS.has(token))) throw new TypeError(`policy.webPreview.sandbox tokens must be from: ${[...SANDBOX_TOKENS].join(', ')}`);
  const hostOrigins = normalizeOrigins(policy.webPreview?.hostOrigins ?? [], 'policy.webPreview.hostOrigins');
  if (sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin') && !hostOrigins.length) {
    throw new TypeError('policy.webPreview: allow-scripts with allow-same-origin requires hostOrigins so previews of the host page origin can be rejected');
  }
  const target = policy.link?.target ?? catalog.policy.link.target;
  if (!['blank', 'self'].includes(target)) throw new TypeError('policy.link.target must be blank or self');

  const enabled = {};
  for (const type of types) {
    const spec = catalog.components[type];
    enabled[type] = { category: spec.category, description: spec.description, slots: spec.slots, ...(spec.binding ? { binding: spec.binding } : {}), props: spec.props };
  }
  for (const [type, spec] of Object.entries(extensions)) {
    if (!extensionPattern.test(type)) throw new TypeError(`Extension ${JSON.stringify(type)} must be namespaced, for example acme:Map`);
    if (!spec || typeof spec.description !== 'string' || !spec.props || typeof spec.props !== 'object') throw new TypeError(`Extension ${type} needs a description and props`);
    for (const [name, prop] of Object.entries(spec.props)) {
      if (['type', 'id', 'visibleWhen'].includes(name) || !prop || typeof prop.schema !== 'object') throw new TypeError(`Extension ${type}.${name} needs a schema`);
    }
    enabled[type] = { category: 'extension', description: spec.description, slots: spec.slots || [], props: structuredClone(spec.props), extension: true };
  }
  const contract = {
    contractVersion: 1,
    profile: components === undefined && actions === null && !Object.keys(extensions).length ? 'standard' : 'deployment',
    protocolVersion: PROTOCOL_VERSION,
    packageVersion: PACKAGE_VERSION,
    components: enabled,
    actions: normalizedActions,
    limits: mergedLimits,
    policy: { urls, webPreview: { sandbox: [...sandbox], hostOrigins }, link: { target } }
  };
  // packageVersion is excluded from identity so a package upgrade with an identical contract keeps the same id.
  const { packageVersion, ...identity } = contract;
  return deepFreeze({ id: `iui-${fingerprint(canonicalJSON(identity))}`, ...contract });
}

let standard;
/** The static standard profile shipped as protocol/contract.json. */
export function standardContract() { return standard ||= createContract(); }

/** Checks that a value is a contract this package can use (for example, one loaded from JSON). */
export function assertContract(contract) {
  if (!contract || contract.contractVersion !== 1 || typeof contract.id !== 'string' || !contract.components || !contract.limits || !contract.policy?.urls) throw new TypeError('Not a valid Intelligence UI contract');
  const major = String(contract.protocolVersion).split('.')[0];
  if (major !== PROTOCOL_VERSION.split('.')[0]) throw new TypeError(`Contract protocol ${contract.protocolVersion} is not supported by this package (${PROTOCOL_VERSION})`);
  return contract;
}
