#!/usr/bin/env node
// Generates every protocol artifact from protocol/components.json. `--check` fails when committed files are stale.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(await readFile(path.join(root, 'protocol/components.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const check = process.argv.includes('--check');
const BASE = `urn:intelligence-ui:protocol:${source.protocolVersion}`;
const outputs = new Map();
const json = value => JSON.stringify(value, null, 2) + '\n';

// Replace "@binding"-style placeholders; "@children" expands differently for shallow and full schemas.
function expand(schema, children) {
  if (schema === '@children') return structuredClone(children);
  if (typeof schema === 'string' && schema.startsWith('@') && source.patterns[schema.slice(1)]) return source.patterns[schema.slice(1)];
  if (Array.isArray(schema)) return schema.map(item => expand(item, children));
  if (schema && typeof schema === 'object') return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, expand(value, children)]));
  return schema;
}
function componentSchema(type, spec, children, visibleWhen) {
  const properties = { type: { const: type }, id: { type: 'string', pattern: source.patterns.id }, visibleWhen };
  const required = ['type', 'id'];
  for (const [name, prop] of Object.entries(spec.props)) {
    properties[name] = { ...expand(prop.schema, children), ...(prop.description ? { description: prop.description } : {}), ...(prop.default !== undefined ? { default: prop.default } : {}) };
    if (prop.required) required.push(name);
  }
  return { type: 'object', description: spec.description, additionalProperties: false, required, properties };
}

const scalar = { type: ['string', 'number', 'boolean', 'null'] };
const fieldValue = { anyOf: [{ type: ['string', 'number', 'boolean', 'null'] }, { type: 'array', maxItems: source.limits.maxOptions, items: { type: 'string' } }] };
const documentId = '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$';
const datasetSchema = {
  type: 'object', additionalProperties: false, required: ['rows'],
  properties: { rows: { type: 'array', maxItems: source.limits.maxDatasetRows, items: { type: 'object', maxProperties: 50, additionalProperties: scalar } } }
};
function documentSchema(rootSchema) {
  return {
    type: 'object', additionalProperties: false, required: ['schemaVersion', 'root'],
    properties: {
      schemaVersion: { type: 'string', pattern: '^[0-9]+\\.[0-9]+$', description: `Protocol version; this release supports ${source.protocolVersion}.` },
      title: { type: 'string', maxLength: 200 },
      root: rootSchema,
      datasets: { type: 'object', maxProperties: source.limits.maxDatasets, propertyNames: { pattern: source.patterns.dataset }, additionalProperties: datasetSchema }
    }
  };
}
const stateSchema = {
  type: 'object', additionalProperties: false, required: ['values', 'dirty'],
  properties: {
    values: { type: 'object', propertyNames: { pattern: source.patterns.binding }, additionalProperties: fieldValue },
    dirty: { type: 'array', maxItems: source.limits.maxComponents, items: { type: 'string', pattern: source.patterns.binding } },
    archived: {
      type: 'array', maxItems: 1000,
      items: {
        type: 'object', additionalProperties: false, required: ['bind', 'value', 'revision', 'reason'],
        properties: { bind: { type: 'string', pattern: source.patterns.binding }, value: fieldValue, revision: { type: 'integer', minimum: 0 }, reason: { enum: ['removed', 'type-changed', 'value-removed'] } }
      }
    }
  }
};
const eventSchema = {
  type: 'object', additionalProperties: false, required: ['eventId', 'documentId', 'baseRevision', 'sourceId', 'actionId', 'values'],
  properties: {
    eventId: { type: 'string', minLength: 1, maxLength: 128 },
    documentId: { type: 'string', pattern: documentId },
    baseRevision: { type: 'integer', minimum: 1 },
    sourceId: { type: 'string', pattern: source.patterns.id },
    actionId: { type: 'string', pattern: source.patterns.action },
    values: { type: 'object', propertyNames: { pattern: source.patterns.binding }, additionalProperties: fieldValue }
  }
};
function committedSchema(documentRef) {
  return {
    type: 'object', additionalProperties: false, required: ['id', 'revision', 'document', 'state'],
    properties: { id: { type: 'string', pattern: documentId }, revision: { type: 'integer', minimum: 1 }, contractId: { type: 'string', maxLength: 100 }, document: documentRef, state: stateSchema }
  };
}

// Portable recursive schema.
const visibleWhenFull = expand(source.visibleWhen.schema);
const childrenFull = { type: 'array', maxItems: source.limits.maxComponents, items: { $ref: '#/$defs/Component' } };
const types = Object.keys(source.components);
const defs = { Component: { oneOf: types.map(type => ({ $ref: `#/$defs/${type}` })) }, VisibleWhen: visibleWhenFull };
for (const type of types) defs[type] = componentSchema(type, source.components[type], childrenFull, { $ref: '#/$defs/VisibleWhen' });
const uiDocument = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${BASE}:ui-document`, title: 'Intelligence UI document candidate', ...documentSchema({ $ref: '#/$defs/Component' }), $defs: defs };
const interactionEvent = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${BASE}:interaction-event`, title: 'Intelligence UI interaction event', ...eventSchema };
const delivery = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${BASE}:delivery`, title: 'Intelligence UI delivery message',
  oneOf: [{ $ref: '#/$defs/CommittedMessage' }, { $ref: '#/$defs/ProposedMessage' }, { $ref: '#/$defs/ActionStatusMessage' }],
  $defs: {
    CommittedDocument: committedSchema({ $ref: `${BASE}:ui-document` }),
    State: stateSchema,
    CommittedMessage: { type: 'object', additionalProperties: false, required: ['type', 'committed'], properties: { type: { const: 'document.committed' }, surfaceId: { type: 'string' }, committed: { $ref: '#/$defs/CommittedDocument' } } },
    ProposedMessage: { type: 'object', additionalProperties: false, required: ['type', 'documentId', 'baseRevision', 'candidate'], properties: { type: { const: 'document.proposed' }, surfaceId: { type: 'string' }, documentId: { type: 'string', pattern: documentId }, baseRevision: { type: 'integer', minimum: 0 }, candidate: { $ref: `${BASE}:ui-document` } } },
    ActionStatusMessage: { type: 'object', additionalProperties: false, required: ['type', 'eventId', 'documentId', 'status'], properties: { type: { const: 'action.status' }, surfaceId: { type: 'string' }, eventId: { type: 'string', minLength: 1, maxLength: 128 }, documentId: { type: 'string', pattern: documentId }, status: { enum: ['accepted', 'succeeded', 'failed'] }, message: { type: 'string', maxLength: 1000 } } },
    ApplyOutcome: { type: 'object', required: ['outcome'], properties: { outcome: { enum: ['applied', 'unchanged', 'stale', 'conflict', 'rejected', 'unsupported-protocol', 'incompatible-capabilities'] }, merge: { type: 'array' }, diagnostics: { type: 'array' } } }
  }
};
outputs.set('protocol/ui-document.schema.json', json(uiDocument));
outputs.set('protocol/interaction-event.schema.json', json(interactionEvent));
outputs.set('protocol/delivery.schema.json', json(delivery));

// Precompiled shallow validators: children are checked one node at a time by lib/protocol/validate.mjs.
const childrenShallow = { type: 'array' };
const visibleWhenShallow = expand(source.visibleWhen.schema);
const shallow = { document: documentSchema({ type: 'object' }), event: eventSchema, state: stateSchema, committed: committedSchema({ type: 'object' }) };
for (const type of types) shallow[type] = componentSchema(type, source.components[type], childrenShallow, visibleWhenShallow);
const ajv = new Ajv2020({ code: { source: true, esm: true, optimize: true }, allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true, unicodeRegExp: true });
for (const [name, schema] of Object.entries(shallow)) ajv.addSchema({ $id: name, ...schema });
let code = standaloneCode(ajv, Object.fromEntries(Object.keys(shallow).map(name => [name.replace(/[^a-zA-Z0-9]/g, '_'), name])));
// Inline Ajv runtime helpers so the browser bundle never depends on Ajv.
const runtimeHelpers = {
  ucs2length: 'function(str){let length=0,pos=0,value;while(pos<str.length){length++;value=str.charCodeAt(pos++);if(value>=0xd800&&value<=0xdbff&&pos<str.length){value=str.charCodeAt(pos);if((value&0xfc00)===0xdc00)pos++;}}return length;}'
};
code = code.replace(/require\("ajv\/dist\/runtime\/(\w+)"\)\.default/g, (match, name) => {
  if (!runtimeHelpers[name]) throw new Error(`Unsupported Ajv runtime helper ${name}`);
  return `(${runtimeHelpers[name]})`;
});
if (/require\(|import /.test(code)) throw new Error('Generated validators must not import modules');
outputs.set('lib/protocol/validators.mjs', `// Generated by scripts/generate.mjs from protocol/components.json. Do not edit.\n/* eslint-disable */\n${code}\n`);

const catalog = { protocolVersion: source.protocolVersion, packageVersion: pkg.version, patterns: source.patterns, limits: source.limits, policy: source.policy, visibleWhen: source.visibleWhen, components: {}, aliases: source.aliases };
for (const [type, spec] of Object.entries(source.components)) {
  catalog.components[type] = { ...spec, props: Object.fromEntries(Object.entries(spec.props).map(([name, prop]) => [name, { ...prop, schema: expand(prop.schema, { type: 'array', items: { $ref: 'Component' } }) }])) };
}
outputs.set('lib/protocol/catalog.mjs', `// Generated by scripts/generate.mjs from protocol/components.json. Do not edit.\nexport const catalog = ${JSON.stringify(catalog, null, 2)};\n`);

// TypeScript declarations for the component tree.
function tsType(schema) {
  if (!schema) return 'unknown';
  if (schema.$ref === 'Component' || schema.items?.$ref === 'Component') return schema.type === 'array' ? 'Component[]' : 'Component';
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const list = [].concat(schema.type || []);
  return list.map(type => {
    if (type === 'integer' || type === 'number') return 'number';
    if (type === 'array') return `Array<${schema.items ? tsType(schema.items) : 'unknown'}>`;
    if (type === 'object') {
      if (!schema.properties) return 'Record<string, unknown>';
      return `{ ${Object.entries(schema.properties).map(([key, value]) => `${key}${(schema.required || []).includes(key) ? '' : '?'}: ${tsType(value)}`).join('; ')} }`;
    }
    return type;
  }).join(' | ') || 'unknown';
}
let dts = '// Generated by scripts/generate.mjs from protocol/components.json. Do not edit.\n';
dts += `export interface VisibleWhen { bind: string; op: ${source.visibleWhen.schema.properties.op.enum.map(v => JSON.stringify(v)).join(' | ')}; value?: string | number | boolean | Array<string | number | boolean>; }\n`;
dts += 'interface ComponentBase { id: string; visibleWhen?: VisibleWhen; }\n';
for (const [type, spec] of Object.entries(catalog.components)) {
  dts += `/** ${spec.description} */\nexport interface ${type}Component extends ComponentBase {\n  type: '${type}';\n`;
  for (const [name, prop] of Object.entries(spec.props)) dts += `  /** ${prop.description}${prop.default !== undefined ? ` Default: ${JSON.stringify(prop.default)}.` : ''} */\n  ${name}${prop.required ? '' : '?'}: ${tsType(prop.schema)};\n`;
  dts += '}\n';
}
dts += `export type StandardComponentType = ${types.map(t => `'${t}'`).join(' | ')};\nexport type Component = ${types.map(t => `${t}Component`).join(' | ')};\n`;
dts += `export interface Dataset { rows: Array<Record<string, string | number | boolean | null>>; }\nexport interface UIDocument { schemaVersion: string; title?: string; root: Component; datasets?: Record<string, Dataset>; }\n`;
outputs.set('types/protocol-components.d.ts', dts);

// Write the catalog first: contract.mjs and instructions.mjs import it.
async function emit(file, content) {
  const target = path.join(root, file);
  const current = await readFile(target, 'utf8').catch(() => null);
  if (current === content) return false;
  if (check) { console.error(`stale: ${file}`); process.exitCode = 1; return true; }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  console.log(`wrote ${file}`);
  return true;
}
for (const [file, content] of outputs) await emit(file, content);
if (check && process.exitCode) process.exit(1);

const { createContract } = await import(pathToFileURL(path.join(root, 'lib/protocol/contract.mjs')).href + `?t=${Date.now()}`);
const { instructions } = await import(pathToFileURL(path.join(root, 'lib/protocol/instructions.mjs')).href + `?t=${Date.now()}`);
const contract = createContract();
await emit('protocol/contract.json', json(contract));
await emit('protocol/instructions.md', instructions(contract));

let reference = `# Component reference\n\nGenerated from \`protocol/components.json\` (protocol ${source.protocolVersion}). Every component also accepts \`type\`, a unique \`id\`, and an optional \`visibleWhen\` condition.\n\n`;
reference += `| Component | Category | Purpose |\n| --- | --- | --- |\n${types.map(t => `| [${t}](#${t.toLowerCase()}) | ${source.components[t].category} | ${source.components[t].description} |`).join('\n')}\n\n`;
for (const [type, spec] of Object.entries(catalog.components)) {
  reference += `## ${type}\n\n${spec.description}\n\n`;
  const binding = spec.binding ? (spec.binding.type || Object.entries(spec.binding.map).map(([k, v]) => `${spec.binding.byProp} ${k === '*' ? 'other' : k}: ${v}`).join(', ')) : null;
  if (binding) reference += `Stored value: ${binding}.\n\n`;
  const props = Object.entries(spec.props);
  if (props.length) reference += `| Property | Type | Required | Default | Description |\n| --- | --- | --- | --- | --- |\n${props.map(([name, prop]) => `| \`${name}\` | \`${tsType(prop.schema).replace(/\|/g, '\\|')}\` | ${prop.required ? 'yes' : 'no'} | ${prop.default !== undefined ? `\`${JSON.stringify(prop.default)}\`` : ''} | ${prop.description.replace(/\|/g, '\\|')} |`).join('\n')}\n\n`;
  reference += '```json\n' + JSON.stringify(spec.example, null, 2) + '\n```\n\n';
}
reference += `## visibleWhen\n\n${source.visibleWhen.description}\n\n\`\`\`json\n{ "bind": "destination", "op": "equals", "value": "berlin" }\n\`\`\`\n`;
await emit('docs/components.md', reference);

// The Skill ships copies so it works without the package installed.
await emit('skill/intelligence-ui/references/contract.json', json(contract));
await emit('skill/intelligence-ui/references/components.md', reference);
for (const file of (await readdir(path.join(root, 'protocol/examples'))).filter(name => name.endsWith('.json'))) {
  await emit(`skill/intelligence-ui/references/examples/${file}`, await readFile(path.join(root, 'protocol/examples', file), 'utf8'));
}
if (check && process.exitCode) process.exit(1);
