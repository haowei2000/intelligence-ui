import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryUIStore, SqliteUIStore, createUIService } from '@haowei2000/intelligence-ui/node';
import { commitDocument, createContract } from '@haowei2000/intelligence-ui/protocol';

const dir = await mkdtemp(path.join(os.tmpdir(), 'iui-store-'));
const candidate = { schemaVersion: '1.0', root: { type: 'Toggle', id: 't', bind: 'on', label: 'On' } };
const stores = {
  memory: options => new MemoryUIStore(options),
  sqlite: options => new SqliteUIStore(path.join(dir, `${Math.random().toString(36).slice(2)}.db`), options)
};

for (const [name, make] of Object.entries(stores)) {
  test(`${name} store: documents use compare-and-set and keep commit order`, async () => {
    const store = make();
    const one = commitDocument(candidate, { id: 'a', revision: 1 }).committed;
    assert.equal(await store.commit('s', one, 0), true);
    assert.equal(await store.commit('s', one, 0), false, 'second create loses');
    const two = commitDocument(candidate, { id: 'a', revision: 2, previous: one }).committed;
    assert.equal(await store.commit('s', two, 0), false);
    assert.equal(await store.commit('s', two, 1), true);
    assert.equal(await store.commit('s', two, 1), false, 'stale writer loses');
    await store.commit('s', commitDocument(candidate, { id: 'b', revision: 1 }).committed, 0);
    assert.deepEqual((await store.listDocuments('s')).map(d => [d.id, d.revision]), [['a', 2], ['b', 1]]);
    assert.deepEqual(await store.listDocuments('other'), []);
    assert.equal(await store.getDocument('s', 'missing'), null);
    await store.putState('s', 'a', { values: { on: true }, dirty: ['on'] });
    assert.deepEqual(await store.getState('s', 'a'), { values: { on: true }, dirty: ['on'] });
    store.close?.();
  });

  test(`${name} store: event log acknowledges by cursor, filters surfaces and reports expiry`, async () => {
    let now = 1000;
    const store = make({ eventRetentionMs: 1000, now: () => now });
    const add = (id, surfaceId = 's') => store.appendEvent({ eventId: id, surfaceId, principalId: 'u', event: { documentId: 'd' }, status: 'accepted' });
    await add('a'); await add('b'); await add('x', 'other');
    const first = await store.readEvents({ cursor: 0, limit: 1, surfaces: ['s'] });
    assert.deepEqual(first.events.map(e => e.eventId), ['a']);
    const second = await store.readEvents({ cursor: first.cursor, surfaces: ['s'] });
    assert.deepEqual(second.events.map(e => e.eventId), ['b']);
    assert.equal(second.expired, false);
    assert.ok(await store.findEvent('a'), 'acknowledged ids still deduplicate');
    await store.updateEvent('b', { status: 'succeeded', message: 'ok' });
    assert.equal((await store.findEvent('b')).status, 'succeeded');
    assert.deepEqual((await store.readEvents({ cursor: 0 })).events.map(e => e.eventId), ['b', 'x'], 'only events up to a passed cursor are acknowledged');
    await add('c');
    now = 10000;
    const late = await store.readEvents({ cursor: second.cursor, surfaces: ['s'] });
    assert.equal(late.expired, true);
    assert.deepEqual(late.events, []);
    store.close?.();
  });
}

test('two services sharing one SQLite file detect each other\'s commits', async () => {
  const file = path.join(dir, 'shared.db');
  const contract = createContract();
  const principal = { id: 'agent', roles: ['agent'], surfaces: ['*'] };
  const [a, b] = [new SqliteUIStore(file), new SqliteUIStore(file)].map(store => createUIService({ contract, store, authenticate: () => principal }));
  const document = { schemaVersion: '1.0', root: { type: 'Text', id: 't', text: 'Hi' } };
  assert.equal((await a.publish({ principal, surfaceId: 's', documentId: 'd', document, baseRevision: 0 })).status, 'committed');
  const conflict = await b.publish({ principal, surfaceId: 's', documentId: 'd', document, baseRevision: 0 });
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.currentRevision, 1);
  assert.equal((await b.publish({ principal, surfaceId: 's', documentId: 'd', document, baseRevision: 1 })).committed.revision, 2);
  a.store.close(); b.store.close();
});
