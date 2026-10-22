/**
 * Durable store on node:sqlite (Node 22.13+). Several processes on one machine can share the file:
 * commit() is a single conditional statement, so compare-and-set stays atomic across them.
 */
export class SqliteUIStore {
  constructor(file, { eventRetentionMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    // Loaded on use so importing intelligence-ui/node keeps working on Node versions without node:sqlite.
    const sqlite = process.getBuiltinModule?.('node:sqlite');
    if (!sqlite) throw new Error('SqliteUIStore needs Node.js 22.13 or newer (node:sqlite)');
    this.db = new sqlite.DatabaseSync(file);
    this.eventRetentionMs = eventRetentionMs; this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS documents (surface TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, committed_at INTEGER NOT NULL, PRIMARY KEY (surface, id));
      CREATE TABLE IF NOT EXISTS states (surface TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (surface, id));
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, surface TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('expired_up_to', 0);
    `);
  }
  close() { this.db.close(); }
  async getDocument(surfaceId, documentId) {
    const row = this.db.prepare('SELECT body FROM documents WHERE surface = ? AND id = ?').get(surfaceId, documentId);
    return row ? JSON.parse(row.body) : null;
  }
  async listDocuments(surfaceId) {
    return this.db.prepare('SELECT body FROM documents WHERE surface = ? ORDER BY committed_at, id').all(surfaceId).map(row => JSON.parse(row.body));
  }
  async commit(surfaceId, committed, expectedRevision) {
    const body = JSON.stringify(committed);
    const result = expectedRevision === 0
      ? this.db.prepare('INSERT OR IGNORE INTO documents (surface, id, revision, body, committed_at) VALUES (?, ?, ?, ?, ?)').run(surfaceId, committed.id, committed.revision, body, this.now())
      : this.db.prepare('UPDATE documents SET revision = ?, body = ? WHERE surface = ? AND id = ? AND revision = ?').run(committed.revision, body, surfaceId, committed.id, expectedRevision);
    return result.changes === 1;
  }
  async getState(surfaceId, documentId) {
    const row = this.db.prepare('SELECT body FROM states WHERE surface = ? AND id = ?').get(surfaceId, documentId);
    return row ? JSON.parse(row.body) : null;
  }
  async putState(surfaceId, documentId, state) {
    this.db.prepare('INSERT INTO states (surface, id, body) VALUES (?, ?, ?) ON CONFLICT (surface, id) DO UPDATE SET body = excluded.body').run(surfaceId, documentId, JSON.stringify(state));
  }
  expire() {
    const limit = this.now() - this.eventRetentionMs;
    const dropped = this.db.prepare('SELECT MAX(sequence) AS sequence FROM events WHERE received_at < ? AND acknowledged = 0').get(limit).sequence;
    if (dropped) this.db.prepare('UPDATE meta SET value = MAX(value, ?) WHERE key = ?').run(dropped, 'expired_up_to');
    this.db.prepare('DELETE FROM events WHERE received_at < ?').run(limit);
  }
  async findEvent(eventId) {
    const row = this.db.prepare('SELECT body FROM events WHERE event_id = ?').get(eventId);
    return row ? JSON.parse(row.body) : null;
  }
  async appendEvent(record) {
    this.expire();
    const receivedAt = this.now();
    const result = this.db.prepare('INSERT INTO events (event_id, surface, body, received_at) VALUES (?, ?, ?, ?)').run(record.eventId, record.surfaceId, JSON.stringify({ ...record, receivedAt }), receivedAt);
    const sequence = Number(result.lastInsertRowid);
    this.db.prepare('UPDATE events SET body = json_set(body, \'$.sequence\', ?) WHERE sequence = ?').run(sequence, sequence);
    return sequence;
  }
  async updateEvent(eventId, changes) {
    const record = await this.findEvent(eventId);
    if (!record) return null;
    const next = { ...record, ...changes };
    this.db.prepare('UPDATE events SET body = ? WHERE event_id = ?').run(JSON.stringify(next), eventId);
    return next;
  }
  async readEvents({ cursor = 0, limit = 50, surfaces = null } = {}) {
    this.expire();
    const after = Number(cursor) || 0;
    const expired = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('expired_up_to').value > after;
    const scope = surfaces ? ` AND surface IN (${surfaces.map(() => '?').join(',') || "''"})` : '';
    this.db.prepare(`UPDATE events SET acknowledged = 1 WHERE sequence <= ?${scope}`).run(after, ...(surfaces || []));
    const rows = this.db.prepare(`SELECT body FROM events WHERE sequence > ? AND acknowledged = 0${scope} ORDER BY sequence LIMIT ?`).all(after, ...(surfaces || []), limit);
    const events = rows.map(row => JSON.parse(row.body));
    const latest = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events').get().sequence;
    return { events, cursor: String(events.length ? events.at(-1).sequence : Math.max(after, latest)), expired };
  }
}
