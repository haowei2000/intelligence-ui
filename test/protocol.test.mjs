import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import { validate, fix, repair, instructions, repairFeedback, createContract, standardContract, compileExtensions } from '@haowei2000/intelligence-ui/agent';
import { commitDocument, checkEvent, checkState, mergeState, fieldsOf } from '@haowei2000/intelligence-ui/protocol';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJSON = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const conformance = await readJSON('protocol/conformance/cases.json');
const text = (id = 't', extra = {}) => ({ type: 'Text', id, text: 'Hello', ...extra });
const doc = (rootNode, extra = {}) => ({ schemaVersion: '1.0', root: rootNode, ...extra });

test('generated artifacts match protocol/components.json', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/generate.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('static contract file equals the standard profile and has a stable identity', async () => {
  const file = await readJSON('protocol/contract.json');
  assert.deepEqual(file, JSON.parse(JSON.stringify(standardContract())));
  assert.equal(createContract().id, standardContract().id);
  assert.notEqual(createContract({ actions: ['a'] }).id, standardContract().id);
  assert.equal(createContract({ actions: ['a', 'b'] }).id, createContract({ actions: ['a', 'b'] }).id);
  assert.equal(Object.keys(standardContract().components).length, 18);
  assert.equal(standardContract().actions, null);
  assert.ok(Object.isFrozen(standardContract().policy.urls.image));
});

test('createContract rejects unsafe or malformed host configuration', () => {
  assert.throws(() => createContract({ components: ['Html'] }), /Unknown standard component/);
  assert.throws(() => createContract({ actions: ['bad id'] }), /Invalid action id/);
  assert.throws(() => createContract({ actions: ['a', 'a'] }), /Duplicate/);
  assert.throws(() => createContract({ policy: { urls: { link: { schemes: ['javascript'] } } } }), /schemes/);
  assert.throws(() => createContract({ policy: { urls: { image: { origins: ['example.com'] } } } }), /invalid origin/);
  assert.throws(() => createContract({ policy: { webPreview: { sandbox: ['allow-scripts', 'allow-same-origin'] } } }), /hostOrigins/);
  assert.throws(() => createContract({ policy: { webPreview: { sandbox: ['allow-top-navigation'] } } }), /sandbox/);
  assert.throws(() => createContract({ extensions: { Map: { description: 'x', props: {} } } }), /namespaced/);
  assert.throws(() => createContract({ limits: { maxDepth: 0 } }), /positive integer/);
});

for (const testCase of conformance.cases) {
  test(`conformance: ${testCase.name}`, () => {
    const result = validate(testCase.input, { contract: testCase.contract ? createContract(testCase.contract) : undefined });
    const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => d.code);
    const warnings = result.diagnostics.filter(d => d.severity === 'warning').map(d => d.code);
    assert.equal(result.valid, testCase.expect.valid, JSON.stringify(result.diagnostics, null, 1));
    for (const code of testCase.expect.codes) assert.ok(errors.includes(code), `missing ${code} in ${errors}`);
    for (const code of testCase.expect.warnings || []) assert.ok(warnings.includes(code), `missing warning ${code}`);
    for (const diagnostic of result.diagnostics) {
      assert.match(diagnostic.path, /^(\/[^/]*)*$/);
      assert.ok(['error', 'warning', 'info'].includes(diagnostic.severity));
      assert.equal(typeof diagnostic.message, 'string');
    }
    if (result.valid) { assert.ok(result.document); assert.equal('candidate' in result, false); }
    else assert.equal('document' in result, false);
  });
}

test('the portable schema agrees with the validator on structure', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
  const schema = ajv.compile(await readJSON('protocol/ui-document.schema.json'));
  ajv.addSchema(await readJSON('protocol/ui-document.schema.json').then(s => ({ ...s, $id: s.$id + ':copy' })));
  const delivery = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
  delivery.addSchema(await readJSON('protocol/ui-document.schema.json'));
  const deliveryValidator = delivery.compile(await readJSON('protocol/delivery.schema.json'));
  const eventValidator = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true }).compile(await readJSON('protocol/interaction-event.schema.json'));
  const structural = new Set(['MISSING_PROPERTY', 'UNKNOWN_PROPERTY', 'WRONG_TYPE', 'INVALID_ENUM', 'INVALID_FORMAT', 'UNKNOWN_COMPONENT', 'OUT_OF_RANGE']);
  for (const testCase of conformance.cases) {
    if (typeof testCase.input === 'string' || testCase.contract) continue;
    const result = validate(testCase.input);
    const structurallyInvalid = result.diagnostics.some(d => structural.has(d.code) && d.severity === 'error');
    if (result.valid || structurallyInvalid) assert.equal(schema(testCase.input), !structurallyInvalid, testCase.name);
  }
  for (const file of await readdir(path.join(root, 'protocol/examples'))) {
    const example = await readJSON(`protocol/examples/${file}`);
    assert.ok(schema(example), file);
    const { committed } = commitDocument(example, { id: file.replace('.json', ''), revision: 1 });
    assert.ok(deliveryValidator({ type: 'document.committed', committed }), JSON.stringify(deliveryValidator.errors));
  }
  assert.ok(eventValidator({ eventId: 'e', documentId: 'd', baseRevision: 1, sourceId: 's', actionId: 'a', values: { x: ['a'] } }));
});

test('every component has an example in the catalog that validates', async () => {
  const { catalog } = await import('@haowei2000/intelligence-ui/protocol');
  for (const [type, spec] of Object.entries(catalog.components)) {
    const example = structuredClone(spec.example);
    const wrapped = ['Button'].includes(type) && example.action?.type !== 'action' ? { type: 'Form', id: 'wrap', submitAction: 'a', children: [example] } : example;
    const result = validate(doc(wrapped, type === 'Table' ? { datasets: { hotels: { rows: [{ name: 'A', price: 1 }] } } } : type === 'Chart' ? { datasets: { sales: { rows: [{ month: 'Jan', revenue: 10 }] } } } : {}));
    assert.ok(result.valid, `${type}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test('fix applies only declared deterministic rules, reports each change and is idempotent', () => {
  const input = '```json\n' + JSON.stringify({ root: { type: 'Stack', id: 's', direction: 'Horizontal', children: [{ type: 'Slider', id: 'sl', bind: 'n', label: 'N', min: '0', max: '10', step: '1' }, { type: 'Toggle', id: 'tg', bind: 'b', label: 'B', default: 'true' }] } }) + '\n```';
  const result = fix(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.applied.map(change => change.rule).sort(), ['add-schema-version', 'coerce-boolean-string', 'coerce-numeric-string', 'coerce-numeric-string', 'coerce-numeric-string', 'normalize-enum-case', 'strip-markdown-fence'].sort());
  for (const change of result.applied) { assert.ok(change.reason); assert.equal(typeof change.path, 'string'); }
  assert.equal(result.document.root.children[0].min, 0);
  const again = fix(result.document);
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.document, result.document);
});

test('fix never invents ids, renames, swaps actions, drops content or repairs truncation', () => {
  const contract = createContract({ actions: ['submit-plan'] });
  const original = doc({ type: 'Form', id: 'f', submitAction: 'submit-pln', children: [{ type: 'Row', id: 'r', children: [] }, { type: 'Text', text: 'no id' }, text('x', { colour: 'red' }), { type: 'Button', id: 'b', label: 'B', action: { type: 'submit' } }] });
  const frozen = JSON.parse(JSON.stringify(original));
  const result = fix(original, { contract });
  assert.deepEqual(original, frozen, 'input must not be mutated');
  assert.equal(result.valid, false);
  assert.deepEqual(result.applied, []);
  assert.equal(result.candidate.root.submitAction, 'submit-pln');
  assert.equal(result.candidate.root.children[0].type, 'Row');
  assert.equal(result.candidate.root.children[1].id, undefined);
  assert.equal(result.candidate.root.children[2].colour, 'red');
  const codes = result.diagnostics.map(d => d.code);
  for (const code of ['UNREGISTERED_ACTION', 'UNKNOWN_COMPONENT', 'MISSING_PROPERTY', 'UNKNOWN_PROPERTY']) assert.ok(codes.includes(code), code);
  assert.deepEqual(result.diagnostics.find(d => d.code === 'UNREGISTERED_ACTION').alternatives, ['submit-plan']);
  const truncated = fix('{"schemaVersion":"1.0","root":{"type":"Text","id":"t","text":"Hel');
  assert.equal(truncated.valid, false);
  assert.equal(truncated.diagnostics[0].code, 'PARSE_INCOMPLETE');
  assert.equal(truncated.candidate, undefined);
});

test('repair runs a bounded, cancellable model loop and feeds diagnostics back', async () => {
  const contract = createContract({ actions: ['submit-plan'] });
  const seen = [];
  const fixed = await repair(doc({ type: 'Form', id: 'f', submitAction: 'book', children: [] }), { contract, maxAttempts: 2, model: async ({ candidate, feedback, attempt }) => {
    seen.push({ attempt, feedback });
    return { ...candidate, root: { ...candidate.root, submitAction: 'submit-plan' } };
  } });
  assert.equal(fixed.status, 'valid');
  assert.equal(fixed.attempts, 1);
  assert.match(seen[0].feedback, /UNREGISTERED_ACTION/);
  let calls = 0;
  const exhausted = await repair('not json', { contract, maxAttempts: 2, model: async () => { calls++; return 'still not json'; } });
  assert.equal(exhausted.status, 'max-attempts');
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  assert.equal((await repair('x', { model: async () => 'y', signal: controller.signal })).status, 'cancelled');
  assert.equal((await repair('x', { model: async () => { throw new Error('down'); } })).status, 'model-error');
  await assert.rejects(repair('x', { model: () => {}, maxAttempts: 99 }), /maxAttempts/);
});

test('diagnostics stop predictably on large and deeply nested input', () => {
  const many = doc({ type: 'Stack', id: 's', children: Array.from({ length: 2000 }, () => text('same')) });
  const started = performance.now();
  const result = validate(many, { contract: createContract({ limits: { maxBytes: 4 * 1024 * 1024 } }) });
  assert.ok(performance.now() - started < 2000);
  assert.equal(result.truncated, true);
  assert.ok(result.diagnostics.length <= standardContract().limits.maxDiagnostics + 1);
  let deep = text('leaf');
  for (let i = 0; i < 5000; i++) deep = { type: 'Stack', id: `s${i}`, children: [deep] };
  const deepResult = validate(doc(deep), { contract: createContract({ limits: { maxBytes: 4 * 1024 * 1024 } }) });
  assert.equal(deepResult.valid, false);
  assert.ok(deepResult.diagnostics.some(d => d.code === 'LIMIT_DEPTH'));
});

test('instructions describe the contract and repair feedback lists errors', () => {
  const contract = createContract({ components: ['Text', 'Form', 'Button', 'Choice'], actions: [{ id: 'submit-plan', input: 'form', description: 'Saves the plan' }] });
  const text = instructions(contract);
  assert.match(text, /### Choice/);
  assert.doesNotMatch(text, /### WebPreview/);
  assert.match(text, /`submit-plan` \(Form submitAction only\): Saves the plan/);
  assert.match(text, new RegExp(contract.id));
  const example = text.match(/```json\n([\s\S]+?)\n```/)[1];
  assert.equal(validate(example, { contract }).valid, true);
  const feedback = repairFeedback(validate(doc({ type: 'Text', id: 't' }), { contract }));
  assert.match(feedback, /MISSING_PROPERTY at \/root\/text/);
});

test('extensions validate through compiled schemas', async () => {
  const contract = createContract({ extensions: { 'acme:Map': { description: 'A map', props: { lat: { schema: { type: 'number' }, required: true, description: 'Latitude' } } } } });
  const extensionValidators = await compileExtensions(contract);
  assert.equal(validate(doc({ type: 'acme:Map', id: 'm', lat: 1 }), { contract, extensionValidators }).valid, true);
  assert.equal(validate(doc({ type: 'acme:Map', id: 'm', lat: 'x' }), { contract, extensionValidators }).valid, false);
  assert.equal(validate(doc({ type: 'other:Map', id: 'm' }), { contract }).valid, false);
});

test('merge table: every row has defined behavior', () => {
  const v1 = doc({ type: 'Form', id: 'f', submitAction: 'a', children: [
    { type: 'Choice', id: 'c', bind: 'city', label: 'City', mode: 'single', options: [{ value: 'berlin', label: 'B' }, { value: 'paris', label: 'P' }] },
    { type: 'Input', id: 'n', bind: 'name', label: 'Name', default: 'Agent default' },
    { type: 'Input', id: 'age', bind: 'age', label: 'Age' },
    { type: 'Input', id: 'gone', bind: 'gone', label: 'Gone' },
    { type: 'Toggle', id: 'k', bind: 'keep', label: 'Keep' },
    { type: 'Choice', id: 'tags', bind: 'tags', label: 'Tags', mode: 'multiple', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }
  ] });
  const v2 = structuredClone(v1);
  const [city, name, age, , keep, tags] = v2.root.children;
  city.options = [{ value: 'berlin', label: 'B' }, { value: 'rome', label: 'R' }];
  name.default = 'New default';
  Object.assign(age, { kind: 'number' });
  v2.root.children.splice(3, 1);
  keep.default = true;
  tags.options = [{ value: 'a', label: 'A' }];
  v2.root.children.push({ type: 'Input', id: 'new', bind: 'fresh', label: 'Fresh', default: 'hello' });
  const local = { values: { city: 'paris', name: 'Mine', age: '42', gone: 'typed', keep: false, tags: ['a', 'b'] }, dirty: ['city', 'name', 'age', 'gone', 'tags'] };
  const { state, outcomes } = mergeState({ previous: v1, next: v2, local, revision: 2 });
  assert.equal(state.values.name, 'Mine', 'dirty input is kept; a new default never replaces it');
  assert.equal(state.values.keep, true, 'not dirty: the new default applies');
  assert.equal(state.values.fresh, 'hello', 'new field gets its default');
  assert.equal(state.values.city, '', 'removed choice value is cleared');
  assert.ok(state.dirty.includes('city'), 'and the field stays dirty');
  assert.deepEqual(state.values.tags, ['a']);
  assert.equal(state.values.age, null, 'incompatible type change resets to the new default');
  assert.ok(!state.dirty.includes('age'));
  assert.equal(state.values.gone, undefined);
  const byBind = Object.fromEntries(outcomes.map(o => [o.bind, o.outcome]));
  assert.deepEqual(byBind, { city: 'value-removed', age: 'type-changed', tags: 'value-removed', gone: 'removed' });
  assert.deepEqual(state.archived.map(a => [a.bind, a.reason]).sort(), [['age', 'type-changed'], ['city', 'value-removed'], ['gone', 'removed'], ['tags', 'value-removed']]);
  const reset = mergeState({ previous: v1, next: v2, local, reset: ['name'], revision: 2 });
  assert.equal(reset.state.values.name, 'New default');
  assert.ok(!reset.state.dirty.includes('name'));
  assert.ok(reset.outcomes.some(o => o.bind === 'name' && o.outcome === 'reset'));
});

test('host checks re-validate events and saved state against the committed revision', () => {
  const candidate = doc({ type: 'Stack', id: 'st', children: [
    { type: 'Form', id: 'f', submitAction: 'submit-plan', children: [
      { type: 'Choice', id: 'c', bind: 'city', label: 'City', mode: 'single', required: true, options: [{ value: 'berlin', label: 'B' }] },
      { type: 'Toggle', id: 't', bind: 'extra', label: 'Extra' },
      { type: 'Input', id: 'i', bind: 'detail', label: 'Detail', required: true, visibleWhen: { bind: 'extra', op: 'equals', value: true } },
      { type: 'Button', id: 'go', label: 'Go', action: { type: 'submit' } }
    ] },
    { type: 'Input', id: 'outside', bind: 'outside', label: 'Outside' },
    { type: 'Button', id: 'refresh', label: 'Refresh', action: { type: 'action', actionId: 'refresh' } }
  ] });
  const { committed } = commitDocument(candidate, { id: 'd', revision: 3 });
  const event = values => ({ eventId: 'e1', documentId: 'd', baseRevision: 3, sourceId: 'go', actionId: 'submit-plan', values });
  assert.equal(checkEvent(committed, event({ city: 'berlin', extra: false })).ok, true);
  assert.equal(checkEvent(committed, event({ city: 'berlin', extra: true })).code, 'INVALID_VALUES', 'visible required field missing');
  assert.equal(checkEvent(committed, event({ city: 'berlin', extra: true, detail: 'x' })).ok, true);
  assert.equal(checkEvent(committed, event({ city: 'berlin', extra: false, outside: 'x' })).code, 'INVALID_VALUES', 'out of form scope');
  assert.equal(checkEvent(committed, event({ city: 'rome', extra: false })).code, 'INVALID_VALUES', 'not an option');
  assert.equal(checkEvent(committed, event({ city: 'berlin', extra: 'yes' })).code, 'INVALID_VALUES', 'wrong type');
  assert.equal(checkEvent(committed, { ...event({ city: 'berlin', extra: false }), baseRevision: 2 }).status, 409);
  assert.equal(checkEvent(committed, { ...event({ city: 'berlin', extra: false }), actionId: 'other' }).code, 'ACTION_MISMATCH');
  assert.equal(checkEvent(committed, { eventId: 'e2', documentId: 'd', baseRevision: 3, sourceId: 'refresh', actionId: 'refresh', values: {} }).ok, true);
  assert.equal(checkEvent(committed, { eventId: 'e2', documentId: 'd', baseRevision: 3, sourceId: 'outside', actionId: 'refresh', values: {} }).code, 'NOT_AN_ACTION_SOURCE');
  assert.equal(checkEvent(committed, { values: {} }).code, 'INVALID_EVENT');
  assert.deepEqual(checkState(candidate, { values: { city: 'berlin' }, dirty: ['city'] }), []);
  assert.equal(checkState(candidate, { values: { nope: 1 }, dirty: [] })[0].code, 'UNKNOWN_BINDING');
  assert.equal(checkState(candidate, { values: { extra: 'x' }, dirty: [] })[0].code, 'INVALID_VALUE');
  assert.equal(checkState(candidate, { values: { __proto__: 1 } })[0].code, 'INVALID_STATE');
  assert.equal(fieldsOf(candidate).size, 4);
});

test('browser runtime and protocol bundles contain no Node modules, Ajv or code evaluation', async () => {
  for (const entry of ['runtime.mjs', 'protocol.mjs', 'lib/runtime/react.mjs']) {
    const result = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'browser', write: false, metafile: true, format: 'esm', external: ['react'] });
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(inputs.every(file => !/node_modules\/ajv|lib\/service|lib\/host|lib\/store/.test(file)), `${entry}: ${inputs.join(', ')}`);
    const code = result.outputFiles[0].text;
    assert.doesNotMatch(code, /new Function|\beval\(/, entry);
  }
});
