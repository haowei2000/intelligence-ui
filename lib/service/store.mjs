/**
 * In-memory store for committed documents, field state and interaction events.
 * Implement the same methods to use a database; commit() must compare and set atomically.
 */
export class MemoryUIStore {
  constructor({ eventRetentionMs = 24 * 60 * 60 * 1000, maxEvents = 10000, now = () => Date.now() } = {}) {
    this.documents = new Map(); this.states = new Map(); this.events = []; this.eventIds = new Map();
    this.sequence = 0; this.expiredUpTo = 0; this.eventRetentionMs = eventRetentionMs; this.maxEvents = maxEvents; this.now = now;
  }
  key(surfaceId, documentId) { return `${surfaceId}\u0000${documentId}`; }
  async getDocument(surfaceId, documentId) { const doc = this.documents.get(this.key(surfaceId, documentId)); return doc ? structuredClone(doc) : null; }
  async listDocuments(surfaceId) { return [...this.documents.entries()].filter(([key]) => key.startsWith(`${surfaceId}\u0000`)).map(([, doc]) => structuredClone(doc)).sort((a, b) => a.committedAt - b.committedAt).map(({ committedAt, ...doc }) => doc); }
  /** Stores a committed document only if the current revision equals expectedRevision (0 when new). */
  async commit(surfaceId, committed, expectedRevision) {
    const key = this.key(surfaceId, committed.id), current = this.documents.get(key);
    if ((current?.revision ?? 0) !== expectedRevision) return false;
    this.documents.set(key, { ...structuredClone(committed), committedAt: current?.committedAt ?? this.now() });
    return true;
  }
  async getState(surfaceId, documentId) { const state = this.states.get(this.key(surfaceId, documentId)); return state ? structuredClone(state) : null; }
  async putState(surfaceId, documentId, state) { this.states.set(this.key(surfaceId, documentId), structuredClone(state)); }
  async findEvent(eventId) { const record = this.eventIds.get(eventId); return record ? structuredClone(record) : null; }
  async appendEvent(record) {
    this.expire();
    const stored = { ...structuredClone(record), sequence: ++this.sequence, receivedAt: this.now() };
    this.events.push(stored); this.eventIds.set(stored.eventId, stored);
    while (this.events.length > this.maxEvents) this.drop(this.events.shift());
    return stored.sequence;
  }
  async updateEvent(eventId, changes) { const record = this.eventIds.get(eventId); if (record) Object.assign(record, structuredClone(changes)); return record ? structuredClone(record) : null; }
  drop(record) { if (!record.acknowledged) this.expiredUpTo = Math.max(this.expiredUpTo, record.sequence); this.eventIds.delete(record.eventId); }
  expire() { const limit = this.now() - this.eventRetentionMs; while (this.events.length && this.events[0].receivedAt < limit) this.drop(this.events.shift()); }
  /**
   * Returns events after the cursor. Reading with a cursor acknowledges every event up to it, so later
   * reads skip them. `expired` reports that unacknowledged events were dropped by retention.
   */
  async readEvents({ cursor = 0, limit = 50, surfaces = null } = {}) {
    this.expire();
    const after = Number(cursor) || 0;
    const expired = this.expiredUpTo > after;
    // Acknowledged events stay until retention removes them so duplicate event ids are still recognized.
    for (const record of this.events) if (record.sequence <= after && (!surfaces || surfaces.includes(record.surfaceId))) record.acknowledged = true;
    const events = this.events.filter(record => record.sequence > after && !record.acknowledged && (!surfaces || surfaces.includes(record.surfaceId))).slice(0, limit);
    const next = events.length ? events.at(-1).sequence : Math.max(after, this.sequence);
    return { events: structuredClone(events).map(({ acknowledged, ...record }) => record), cursor: String(next), expired };
  }
}
