import { validate } from '../protocol/validate.mjs';
import { fix } from '../protocol/fix.mjs';
import { instructions } from '../protocol/instructions.mjs';
import { assertContract } from '../protocol/contract.mjs';
import { commitDocument, checkEvent, checkState } from '../protocol/state.mjs';
import { MemoryUIStore } from './store.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ROLE_OPERATIONS = {
  agent: new Set(['contract', 'validate', 'publish', 'read', 'read-events', 'report-status']),
  user: new Set(['contract', 'validate', 'read', 'stream', 'event', 'state'])
};

export class UIServiceError extends Error {
  constructor(status, code, message, details = {}) { super(message); this.status = status; this.code = code; Object.assign(this, details); }
}

/**
 * Bearer token authentication for small deployments and examples.
 * tokens: { "<secret>": { id, roles: ["agent" | "user"], surfaces: ["*" | surfaceId] } }
 */
export function tokenAuth(tokens) {
  const entries = new Map(Object.entries(tokens || {}));
  for (const [token, principal] of entries) {
    if (token.length < 16) throw new TypeError('Tokens must be at least 16 characters');
    if (!principal?.id || !Array.isArray(principal.roles) || !Array.isArray(principal.surfaces)) throw new TypeError('Each token needs { id, roles, surfaces }');
  }
  return request => {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization || '');
    return match ? entries.get(match[1]) ?? null : null;
  };
}

/** Default authorization: role permits the operation and the principal is bound to the surface. */
export function defaultAuthorize(principal, { operation, surfaceId }) {
  if (!principal) return false;
  if (!principal.roles?.some(role => ROLE_OPERATIONS[role]?.has(operation))) return false;
  if (surfaceId === undefined) return true;
  return principal.surfaces?.includes('*') || principal.surfaces?.includes(surfaceId);
}

/**
 * Delivery and interaction service. Hosts own authentication (authenticate), authorization
 * (authorize) and business execution (onEvent); the service validates, commits and routes.
 */
export function createUIService({ contract, store = new MemoryUIStore(), authenticate, authorize = defaultAuthorize, onEvent, cors = {}, basePath = '/ui', maxBodyBytes = 1024 * 1024, extensionValidators, onError = error => console.error('intelligence-ui service:', error) } = {}) {
  assertContract(contract);
  if (typeof authenticate !== 'function') throw new TypeError('createUIService needs authenticate(request) => principal | null');
  const subscribers = new Map(), queues = new Map();
  const allowedOrigins = new Set(cors.origins || []);

  const allow = async (principal, operation, surfaceId) => {
    if (!principal) throw new UIServiceError(401, 'UNAUTHENTICATED', 'Authentication required.');
    if (surfaceId !== undefined && !ID.test(surfaceId)) throw new UIServiceError(400, 'INVALID_SURFACE', 'Invalid surface id.');
    if (!(await authorize(principal, { operation, surfaceId }))) throw new UIServiceError(403, 'FORBIDDEN', `Not allowed to ${operation}${surfaceId ? ` on surface ${surfaceId}` : ''}.`);
  };
  // Serializes writes per surface so compare-and-set and broadcast order agree.
  function serialize(surfaceId, task) {
    const run = (queues.get(surfaceId) || Promise.resolve()).then(task);
    queues.set(surfaceId, run.catch(() => {}));
    return run;
  }
  function broadcast(surfaceId, message) {
    for (const listener of subscribers.get(surfaceId) || []) { try { listener(message); } catch { /* a broken stream must not block others */ } }
  }
  function subscribe(surfaceId, listener) {
    if (!subscribers.has(surfaceId)) subscribers.set(surfaceId, new Set());
    subscribers.get(surfaceId).add(listener);
    return () => subscribers.get(surfaceId)?.delete(listener);
  }

  async function publish({ principal, surfaceId, documentId, document, baseRevision, reset = [], resolvesEventId }) {
    await allow(principal, 'publish', surfaceId);
    if (!ID.test(documentId || '')) throw new UIServiceError(400, 'INVALID_DOCUMENT_ID', 'documentId must be 1-80 letters, digits, - or _.');
    if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new UIServiceError(400, 'INVALID_REVISION', 'baseRevision must be the revision you updated (0 for a new document).');
    if (!Array.isArray(reset) || reset.some(bind => typeof bind !== 'string')) throw new UIServiceError(400, 'INVALID_RESET', 'reset must be an array of bind keys.');
    const result = validate(document, { contract, extensionValidators });
    if (!result.valid) return { status: 'rejected', contractId: contract.id, diagnostics: result.diagnostics, truncated: result.truncated };
    return serialize(surfaceId, async () => {
      const current = await store.getDocument(surfaceId, documentId);
      const currentRevision = current?.revision ?? 0;
      if (baseRevision !== currentRevision) return { status: 'conflict', contractId: contract.id, currentRevision, message: `The document is at revision ${currentRevision}; publish with that baseRevision.` };
      const stored = await store.getState(surfaceId, documentId);
      const { committed, outcomes } = commitDocument(result.document, { id: documentId, revision: currentRevision + 1, previous: current, state: stored ?? current?.state, reset, contractId: contract.id });
      if (!(await store.commit(surfaceId, committed, currentRevision))) return { status: 'conflict', contractId: contract.id, currentRevision: (await store.getDocument(surfaceId, documentId))?.revision ?? 0 };
      await store.putState(surfaceId, documentId, committed.state);
      broadcast(surfaceId, { type: 'document.committed', surfaceId, committed });
      if (resolvesEventId) await setEventStatus(surfaceId, resolvesEventId, 'succeeded');
      return { status: 'committed', contractId: contract.id, committed, merge: outcomes, diagnostics: result.diagnostics };
    });
  }

  async function setEventStatus(surfaceId, eventId, status, message) {
    const record = await store.findEvent(eventId);
    if (!record || record.surfaceId !== surfaceId) return null;
    await store.updateEvent(eventId, { status, ...(message ? { message } : {}) });
    broadcast(surfaceId, { type: 'action.status', surfaceId, eventId, documentId: record.event.documentId, status, ...(message ? { message } : {}) });
    return status;
  }
  async function reportStatus({ principal, surfaceId, eventId, status, message }) {
    await allow(principal, 'report-status', surfaceId);
    if (!['accepted', 'succeeded', 'failed'].includes(status)) throw new UIServiceError(400, 'INVALID_STATUS', 'status must be accepted, succeeded or failed.');
    if (!(await setEventStatus(surfaceId, eventId, status, typeof message === 'string' ? message.slice(0, 1000) : undefined))) throw new UIServiceError(404, 'UNKNOWN_EVENT', 'No such event on this surface.');
    return { status };
  }

  async function submitEvent({ principal, surfaceId, event }) {
    await allow(principal, 'event', surfaceId);
    const previous = event && typeof event.eventId === 'string' ? await store.findEvent(event.eventId) : null;
    if (previous) {
      if (previous.surfaceId !== surfaceId || previous.principalId !== principal.id) throw new UIServiceError(409, 'DUPLICATE_EVENT', 'This event id was already used.');
      return { status: previous.status, duplicate: true, ...(previous.message ? { message: previous.message } : {}) };
    }
    const committed = await store.getDocument(surfaceId, event?.documentId);
    if (!committed) throw new UIServiceError(404, 'UNKNOWN_DOCUMENT', 'No such document on this surface.');
    const check = checkEvent(committed, event, { state: await store.getState(surfaceId, committed.id) });
    if (!check.ok) throw new UIServiceError(check.status, check.code, check.message, check.problems ? { problems: check.problems } : {});
    await store.appendEvent({ eventId: event.eventId, surfaceId, principalId: principal.id, event, status: 'accepted' });
    if (check.form) {
      // Submitted values become the user's state so the next publication preserves them.
      const state = (await store.getState(surfaceId, committed.id)) ?? committed.state;
      state.values = { ...state.values, ...event.values };
      state.dirty = [...new Set([...state.dirty, ...Object.keys(event.values)])];
      await store.putState(surfaceId, committed.id, state);
    }
    let result = { status: 'accepted' };
    if (onEvent) {
      try {
        const returned = await onEvent(structuredClone(event), { principal, surfaceId, committed });
        if (returned && ['accepted', 'succeeded', 'failed'].includes(returned.status)) result = { status: returned.status, ...(typeof returned.message === 'string' ? { message: returned.message.slice(0, 1000) } : {}) };
      } catch (error) {
        result = { status: 'failed', message: 'The action could not be completed.' };
        onError(error);
      }
    }
    if (result.status !== 'accepted') await setEventStatus(surfaceId, event.eventId, result.status, result.message);
    return result;
  }

  async function saveState({ principal, surfaceId, documentId, state, baseRevision }) {
    await allow(principal, 'state', surfaceId);
    return serialize(surfaceId, async () => {
      const committed = await store.getDocument(surfaceId, documentId);
      if (!committed) throw new UIServiceError(404, 'UNKNOWN_DOCUMENT', 'No such document on this surface.');
      if (baseRevision !== committed.revision) throw new UIServiceError(409, 'STALE_REVISION', `State was edited on revision ${baseRevision}; the current revision is ${committed.revision}.`, { currentRevision: committed.revision });
      const problems = checkState(committed.document, state);
      if (problems.length) throw new UIServiceError(422, 'INVALID_STATE', 'State does not match the document.', { problems });
      await store.putState(surfaceId, documentId, state);
      return { status: 'saved', revision: committed.revision };
    });
  }

  async function readEvents({ principal, surfaceId, cursor, limit = 50 }) {
    await allow(principal, 'read-events', surfaceId);
    const surfaces = surfaceId ? [surfaceId] : principal.surfaces?.includes('*') ? null : principal.surfaces;
    const page = await store.readEvents({ cursor, limit: Math.min(Math.max(1, Number(limit) || 50), 200), surfaces });
    return { ...page, events: page.events.map(({ eventId, surfaceId, event, status, message, receivedAt }) => ({ eventId, surfaceId, event, status, ...(message ? { message } : {}), receivedAt: new Date(receivedAt).toISOString() })) };
  }

  async function getDocument({ principal, surfaceId, documentId }) {
    await allow(principal, 'read', surfaceId);
    const committed = await store.getDocument(surfaceId, documentId);
    if (!committed) throw new UIServiceError(404, 'UNKNOWN_DOCUMENT', 'No such document on this surface.');
    const state = await store.getState(surfaceId, documentId);
    return state ? { ...committed, state } : committed;
  }

  async function body(request) {
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > maxBodyBytes) throw new UIServiceError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBodyBytes} bytes.`); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new UIServiceError(400, 'INVALID_JSON', 'Request body is not valid JSON.'); }
  }
  function send(response, status, data, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    response.end(JSON.stringify(data));
  }
  function corsHeaders(request) {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) return {};
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Max-Age': '600' };
  }

  /** Node HTTP handler. Resolves true when the request belonged to this service. */
  async function handle(request, response) {
    const url = new URL(request.url, 'http://service');
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return false;
    const route = url.pathname.slice(basePath.length) || '/';
    const headers = corsHeaders(request);
    if (request.headers.origin && !headers['Access-Control-Allow-Origin'] && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`) {
      send(response, 403, { error: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.' }); return true;
    }
    if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return true; }
    try {
      const principal = await authenticate(request);
      const ok = data => send(response, 200, data, headers);
      const match = route.match(/^\/surfaces\/([^/]+)(\/.*)?$/);
      if (request.method === 'GET' && route === '/contract') { await allow(principal, 'contract'); ok(contract); return true; }
      if (request.method === 'GET' && route === '/instructions') { await allow(principal, 'contract'); response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', ...headers }); response.end(instructions(contract)); return true; }
      if (request.method === 'POST' && (route === '/validate' || route === '/fix')) {
        await allow(principal, 'validate');
        const data = await body(request);
        ok((route === '/fix' ? fix : validate)(data.document, { contract, extensionValidators }));
        return true;
      }
      if (request.method === 'GET' && route === '/events') { ok(await readEvents({ principal, surfaceId: url.searchParams.get('surface') || undefined, cursor: url.searchParams.get('cursor') || 0, limit: url.searchParams.get('limit') })); return true; }
      if (match) {
        const surfaceId = decodeURIComponent(match[1]), rest = match[2] || '';
        const documentMatch = rest.match(/^\/documents\/([^/]+)(\/state)?$/);
        const statusMatch = rest.match(/^\/events\/([^/]+)\/status$/);
        if (request.method === 'GET' && rest === '/stream') { await allow(principal, 'stream', surfaceId); return stream(request, response, surfaceId, headers); }
        if (request.method === 'GET' && rest === '/documents') { await allow(principal, 'read', surfaceId); ok(await store.listDocuments(surfaceId)); return true; }
        if (request.method === 'POST' && rest === '/events') {
          const result = await submitEvent({ principal, surfaceId, event: await body(request) });
          send(response, 202, result, headers); return true;
        }
        if (request.method === 'POST' && statusMatch) { const data = await body(request); ok(await reportStatus({ principal, surfaceId, eventId: decodeURIComponent(statusMatch[1]), status: data.status, message: data.message })); return true; }
        if (documentMatch) {
          const documentId = decodeURIComponent(documentMatch[1]);
          if (request.method === 'GET' && !documentMatch[2]) { ok(await getDocument({ principal, surfaceId, documentId })); return true; }
          if (request.method === 'PUT' && documentMatch[2]) { const data = await body(request); ok(await saveState({ principal, surfaceId, documentId, state: data.state, baseRevision: data.baseRevision })); return true; }
          if (request.method === 'PUT' && !documentMatch[2]) {
            const data = await body(request);
            const result = await publish({ principal, surfaceId, documentId, document: data.document, baseRevision: data.baseRevision, reset: data.reset, resolvesEventId: data.resolvesEventId });
            send(response, result.status === 'committed' ? 200 : result.status === 'conflict' ? 409 : 422, result, headers);
            return true;
          }
        }
      }
      send(response, 404, { error: 'NOT_FOUND', message: 'Unknown route.' }, headers);
    } catch (error) {
      if (error instanceof UIServiceError) { const { status, code, message, ...details } = error; send(response, status, { error: code, message, ...details }, headers); }
      else { onError(error); if (!response.headersSent) send(response, 500, { error: 'INTERNAL', message: 'Internal error.' }, headers); }
    }
    return true;
  }

  async function stream(request, response, surfaceId, headers) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...headers });
    // Send headers now; otherwise Node holds them until the first event and clients wait.
    response.flushHeaders(); response.write(': connected\n\n');
    const write = message => response.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
    const unsubscribe = subscribe(surfaceId, write);
    for (const committed of await store.listDocuments(surfaceId)) {
      const state = await store.getState(surfaceId, committed.id);
      write({ type: 'document.committed', surfaceId, committed: state ? { ...committed, state } : committed });
    }
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25000);
    const stop = () => { clearInterval(keepAlive); unsubscribe(); };
    request.on('close', stop); response.on('close', stop);
    return true;
  }

  return { contract, store, handle, publish, submitEvent, saveState, readEvents, reportStatus, getDocument, subscribe, authenticate, authorize };
}
