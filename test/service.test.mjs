import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createUIService, tokenAuth, MemoryUIStore, createMCPHandler, createMCPHttpHandler } from '@haowei2000/intelligence-ui/node';
import { createContract } from '@haowei2000/intelligence-ui/protocol';
import { readEventStream } from '@haowei2000/intelligence-ui/runtime';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const example = async name => JSON.parse(await readFile(path.join(root, `protocol/examples/${name}.json`), 'utf8'));
const AGENT = 'agent-token-0123456789', USER = 'user-token-0123456789', OTHER = 'other-token-0123456789';
const tokens = {
  [AGENT]: { id: 'agent', roles: ['agent'], surfaces: ['*'], defaultSurface: 'chat-1' },
  [USER]: { id: 'alice', roles: ['user'], surfaces: ['chat-1'] },
  [OTHER]: { id: 'bob', roles: ['user'], surfaces: ['chat-2'] }
};
const contract = createContract({ actions: [{ id: 'submit-plan', input: 'form' }, { id: 'refresh-prices', input: 'none' }, { id: 'save-settings', input: 'form' }] });

async function startService(options = {}) {
  const authenticate = tokenAuth(tokens);
  const handled = [];
  const service = createUIService({ contract, authenticate, cors: { origins: ['https://frontend.example'] }, onEvent: async event => { handled.push(event); return options.result; }, onError: () => {}, ...options.service });
  const mcp = createMCPHttpHandler({ authenticate, handlerFor: principal => createMCPHandler({ service, principal, defaultSurfaceId: principal.defaultSurface }) });
  const server = http.createServer(async (request, response) => { if (!(await service.handle(request, response)) && !(await mcp(request, response))) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, token, body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  return { service, server, base, call, handled, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
async function openStream(base, surface, token) {
  const controller = new AbortController();
  const response = await fetch(`${base}/ui/surfaces/${surface}/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  const messages = [];
  const reading = (async () => { try { for await (const { data } of readEventStream(response.body, controller.signal)) messages.push(JSON.parse(data)); } catch { /* aborted */ } })();
  return { status: response.status, messages, close: async () => { controller.abort(); await reading; } };
}
const waitFor = async (predicate, ms = 2000) => { const end = Date.now() + ms; while (!predicate()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

test('authentication and surface authorization are enforced on every route', async () => {
  const { call, close } = await startService();
  try {
    assert.equal((await call('GET', '/ui/contract')).status, 401);
    assert.equal((await call('GET', '/ui/contract', 'wrong-token-xxxxxxxx')).status, 401);
    assert.equal((await call('GET', '/ui/contract', USER)).body.id, contract.id);
    assert.equal((await call('PUT', '/ui/surfaces/chat-1/documents/trip', USER, { document: {}, baseRevision: 0 })).status, 403, 'users cannot publish');
    assert.equal((await call('GET', '/ui/events', USER)).status, 403, 'users cannot read the event log');
    assert.equal((await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: await example('trip-plan'), baseRevision: 0 })).status, 200);
    assert.equal((await call('GET', '/ui/surfaces/chat-1/documents/trip', OTHER)).status, 403, 'another user cannot read this surface');
    assert.equal((await call('GET', '/ui/surfaces/chat-1/documents/trip', USER)).status, 200);
  } finally { await close(); }
});

test('publication validates first, enforces revisions and never delivers rejected candidates', async () => {
  const { base, call, close } = await startService();
  const stream = await openStream(base, 'chat-1', USER);
  try {
    const trip = await example('trip-plan');
    const bad = await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: { ...trip, root: { ...trip.root, children: [{ type: 'Form', id: 'f', submitAction: 'book-now', children: [] }] } }, baseRevision: 0 });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.status, 'rejected');
    assert.ok(bad.body.diagnostics.some(d => d.code === 'UNREGISTERED_ACTION' && d.expected.allowed.includes('submit-plan')));
    assert.equal((await call('GET', '/ui/surfaces/chat-1/documents/trip', USER)).status, 404);
    const first = await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: trip, baseRevision: 0 });
    assert.equal(first.body.status, 'committed');
    assert.equal(first.body.committed.revision, 1);
    assert.equal(first.body.committed.contractId, contract.id);
    const conflict = await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: trip, baseRevision: 0 });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.currentRevision, 1);
    await waitFor(() => stream.messages.length === 1);
    assert.equal(stream.messages[0].type, 'document.committed');
    assert.equal(stream.messages[0].committed.revision, 1);
    assert.equal(stream.messages.length, 1, 'the rejected and conflicting publications produced no delivery');
  } finally { await stream.close(); await close(); }
});

test('events are re-validated, deduplicated, routed to the host and resolved by the next publication', async () => {
  const { base, call, handled, close } = await startService({ result: { status: 'accepted' } });
  const stream = await openStream(base, 'chat-1', USER);
  try {
    await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: await example('trip-plan'), baseRevision: 0 });
    const event = { eventId: 'evt-1', documentId: 'trip', baseRevision: 1, sourceId: 'submit-trip', actionId: 'submit-plan', values: { destination: 'paris', activities: ['food'], budget: 800, notes: '' } };
    const forged = await call('POST', '/ui/surfaces/chat-1/events', USER, { ...event, eventId: 'evt-x', values: { ...event.values, budget: 99999 } });
    assert.equal(forged.status, 422);
    const scope = await call('POST', '/ui/surfaces/chat-1/events', USER, { ...event, eventId: 'evt-y', values: { ...event.values, admin: true } });
    assert.equal(scope.status, 422);
    assert.ok(scope.body.problems.some(p => p.code === 'OUT_OF_SCOPE'));
    assert.equal((await call('POST', '/ui/surfaces/chat-1/events', USER, { ...event, eventId: 'evt-z', actionId: 'refresh-prices' })).status, 400);
    assert.equal((await call('POST', '/ui/surfaces/chat-2/events', OTHER, event)).status, 404, 'other surfaces do not see this document');
    const accepted = await call('POST', '/ui/surfaces/chat-1/events', USER, event);
    assert.equal(accepted.status, 202);
    assert.deepEqual(accepted.body, { status: 'accepted' });
    const duplicate = await call('POST', '/ui/surfaces/chat-1/events', USER, event);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(handled.length, 1, 'business handler runs once');
    const page = await call('GET', '/ui/events', AGENT);
    assert.equal(page.body.events.length, 1);
    assert.equal(page.body.events[0].event.values.destination, 'paris');
    assert.equal((await call('GET', `/ui/events?cursor=${page.body.cursor}`, AGENT)).body.events.length, 0, 'cursor acknowledges');
    const next = await example('trip-plan');
    next.root.title = 'Paris it is';
    const published = await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: next, baseRevision: 1, resolvesEventId: 'evt-1' });
    assert.equal(published.body.committed.state.values.destination, 'paris', 'submitted values carry into the next revision');
    assert.equal(published.body.committed.state.values.budget, 800);
    await waitFor(() => stream.messages.some(m => m.type === 'action.status'));
    assert.deepEqual(stream.messages.find(m => m.type === 'action.status'), { type: 'action.status', surfaceId: 'chat-1', eventId: 'evt-1', documentId: 'trip', status: 'succeeded' });
    assert.equal((await call('POST', '/ui/surfaces/chat-1/events', USER, { ...event, eventId: 'evt-2' })).status, 409, 'events on an old revision are stale');
  } finally { await stream.close(); await close(); }
});

test('state saves are checked against the committed document and revision', async () => {
  const { call, close } = await startService();
  try {
    await call('PUT', '/ui/surfaces/chat-1/documents/trip', AGENT, { document: await example('trip-plan'), baseRevision: 0 });
    const save = state => call('PUT', '/ui/surfaces/chat-1/documents/trip/state', USER, { state, baseRevision: 1 });
    assert.equal((await save({ values: { notes: 'hi' }, dirty: ['notes'] })).status, 200);
    assert.equal((await save({ values: { budget: 'lots' }, dirty: [] })).status, 422);
    assert.equal((await save({ values: { nothing: 1 }, dirty: [] })).status, 422);
    assert.equal((await call('PUT', '/ui/surfaces/chat-1/documents/trip/state', USER, { state: { values: {}, dirty: [] }, baseRevision: 7 })).status, 409);
    assert.equal((await call('GET', '/ui/surfaces/chat-1/documents/trip', USER)).body.state.values.notes, 'hi');
  } finally { await close(); }
});

test('event log cursors acknowledge, and retention reports expiry instead of skipping silently', async () => {
  let now = 0;
  const store = new MemoryUIStore({ eventRetentionMs: 1000, now: () => now });
  const record = id => store.appendEvent({ eventId: id, surfaceId: 's', principalId: 'u', event: { documentId: 'd' }, status: 'accepted' });
  await record('a'); await record('b');
  const first = await store.readEvents({ cursor: 0, limit: 1 });
  assert.deepEqual(first.events.map(e => e.eventId), ['a']);
  const second = await store.readEvents({ cursor: first.cursor });
  assert.deepEqual(second.events.map(e => e.eventId), ['b']);
  assert.equal(second.expired, false);
  assert.ok(await store.findEvent('a'), 'acknowledged ids are still known for deduplication');
  await record('c');
  now = 5000;
  const late = await store.readEvents({ cursor: second.cursor });
  assert.equal(late.expired, true);
  assert.deepEqual(late.events, []);
});

test('CORS allows only configured origins', async () => {
  const { call, close } = await startService();
  try {
    const allowed = await call('GET', '/ui/contract', USER, undefined, { Origin: 'https://frontend.example' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://frontend.example');
    assert.equal((await call('GET', '/ui/contract', USER, undefined, { Origin: 'https://evil.example' })).status, 403);
  } finally { await close(); }
});

test('MCP over HTTP works with the official SDK client and keeps identity host-controlled', async () => {
  const { base, call, close } = await startService();
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${AGENT}` } } }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['ui_get_capabilities', 'ui_validate', 'ui_fix', 'ui_publish', 'ui_read_events']);
    assert.ok(tools.every(tool => /^[a-z0-9_]+$/.test(tool.name)));
    const capabilities = await client.callTool({ name: 'ui_get_capabilities', arguments: {} });
    assert.equal(capabilities.structuredContent.contract.id, contract.id);
    assert.match(capabilities.structuredContent.instructions, /submit-plan/);
    const fixed = await client.callTool({ name: 'ui_fix', arguments: { document: '```json\n' + JSON.stringify(await example('web-preview')) + '\n```' } });
    assert.equal(fixed.structuredContent.valid, true);
    const rejected = await client.callTool({ name: 'ui_publish', arguments: { documentId: 'p', baseRevision: 0, document: { schemaVersion: '1.0', root: { type: 'Html', id: 'h' } } } });
    assert.equal(rejected.isError, true);
    assert.equal(rejected.structuredContent.status, 'rejected');
    const published = await client.callTool({ name: 'ui_publish', arguments: { documentId: 'p', baseRevision: 0, document: fixed.structuredContent.document } });
    assert.equal(published.structuredContent.status, 'committed');
    assert.equal((await call('GET', '/ui/surfaces/chat-1/documents/p', USER)).status, 200, 'default surface comes from the authenticated principal');
    const events = await client.callTool({ name: 'ui_read_events', arguments: {} });
    assert.deepEqual(events.structuredContent.events, []);
    const anonymous = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(anonymous.status, 401);
    const foreign = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${AGENT}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(foreign.status, 403);
  } finally { await client.close(); await close(); }
});

test('MCP over stdio via the CLI works with the official SDK client', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/studio.mjs'), 'mcp', '--surface', 'local'], stderr: 'pipe' }));
  try {
    const validated = await client.callTool({ name: 'ui_validate', arguments: { document: { schemaVersion: '1.0', root: { type: 'Row', id: 'r' } } } });
    assert.equal(validated.isError, true);
    assert.equal(validated.structuredContent.diagnostics[0].code, 'UNKNOWN_COMPONENT');
    const published = await client.callTool({ name: 'ui_publish', arguments: { documentId: 'hello', baseRevision: 0, document: { schemaVersion: '1.0', root: { type: 'Text', id: 't', text: 'Hi' } } } });
    assert.equal(published.structuredContent.committed.revision, 1);
    const otherSurface = await client.callTool({ name: 'ui_publish', arguments: { surfaceId: 'elsewhere', documentId: 'x', baseRevision: 0, document: { schemaVersion: '1.0', root: { type: 'Text', id: 't', text: 'Hi' } } } });
    assert.equal(otherSurface.structuredContent.error, 'FORBIDDEN');
  } finally { await client.close(); }
});

test('CLI validate and fix use documented exit codes and only write when asked', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iui-cli-'));
  const file = path.join(dir, 'doc.json');
  const original = '```json\n{"schemaVersion":"1.0","root":{"type":"Text","id":"t","text":"Hi","variant":"Heading1"}}\n```';
  await writeFile(file, original);
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/studio.mjs'), ...args], { encoding: 'utf8', input: args.includes('-') ? original : undefined });
  assert.equal(run('validate', file).status, 1);
  const json = run('validate', file, '--format', 'json');
  assert.equal(JSON.parse(json.stdout).valid, false);
  const fixed = run('fix', file);
  assert.equal(fixed.status, 0);
  assert.equal(JSON.parse(fixed.stdout).root.variant, 'heading1');
  assert.equal(await readFile(file, 'utf8'), original, 'fix does not write without --write');
  assert.equal(run('fix', '-', '--format', 'json').status, 0);
  assert.equal(run('fix', file, '--write').status, 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).root.variant, 'heading1');
  assert.equal(run('validate', file).status, 0);
  assert.equal(run('validate', path.join(dir, 'missing.json')).status, 3);
  assert.equal(run('validate', '--format', 'xml').status, 2);
  const deployment = path.join(dir, 'deployment.json');
  await writeFile(deployment, JSON.stringify({ actions: ['submit-plan'] }));
  assert.deepEqual(JSON.parse(run('contract', '--deployment', deployment).stdout).actions, [{ id: 'submit-plan', input: 'any' }]);
  assert.match(run('instructions').stdout, /# Interactive UI output/);
  assert.equal(run('--version').status, 0, 'legacy studio flags still work');
});
