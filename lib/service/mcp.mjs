import { createInterface } from 'node:readline';
import { validate } from '../protocol/validate.mjs';
import { fix } from '../protocol/fix.mjs';
import { instructions } from '../protocol/instructions.mjs';
import { PACKAGE_VERSION } from '../protocol/contract.mjs';
import { UIServiceError } from './service.mjs';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const documentInput = { description: 'UI document candidate as a JSON object, or JSON text.', anyOf: [{ type: 'object' }, { type: 'string' }] };

export const mcpTools = [
  {
    name: 'ui_get_capabilities',
    description: 'Returns the deployment contract (components, actions, limits, URL policy) and the generation instructions. Call once per task and again when a publication reports a different contractId.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { includeInstructions: { type: 'boolean', description: 'Include generation instructions (default true).' } } }
  },
  {
    name: 'ui_validate',
    description: 'Validates a UI document candidate without publishing. Optional: ui_publish always validates.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['document'], properties: { document: documentInput } }
  },
  {
    name: 'ui_fix',
    description: 'Applies deterministic fixes (code fences, numeric or boolean strings, enum case, missing schemaVersion) and returns the repaired candidate, applied fixes and remaining diagnostics. Never invents ids, actions or data.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['document'], properties: { document: documentInput } }
  },
  {
    name: 'ui_publish',
    description: 'Validates, checks the revision and commits a document to a UI surface, then delivers it. Rejected candidates are never shown. Use baseRevision 0 for a new document, otherwise the revision you are replacing.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'baseRevision', 'document'],
      properties: {
        surfaceId: { type: 'string', description: 'Target surface. Defaults to the surface configured for this connection.' },
        documentId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' },
        baseRevision: { type: 'integer', minimum: 0 },
        document: documentInput,
        reset: { type: 'array', items: { type: 'string' }, description: 'Bind keys whose user values should be discarded.' },
        resolvesEventId: { type: 'string', description: 'Marks this interaction event as succeeded once committed.' }
      }
    }
  },
  {
    name: 'ui_read_events',
    description: 'Returns interaction events after a cursor and the next cursor. Passing a cursor acknowledges every event up to it. expired=true means unacknowledged events were dropped by retention.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 }, surfaceId: { type: 'string' } } }
  }
];

/**
 * MCP request handling on top of a UI service. principal is the host-controlled identity for this
 * connection (from stdio configuration or HTTP authentication); the Agent cannot choose it.
 */
export function createMCPHandler({ service, principal, defaultSurfaceId, serverName = 'intelligence-ui' }) {
  const result = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, ...(isError ? { isError: true } : {}) });
  async function callTool(name, args = {}) {
    try {
      switch (name) {
        case 'ui_get_capabilities':
          return result({ contract: service.contract, ...(args.includeInstructions === false ? {} : { instructions: instructions(service.contract) }) });
        case 'ui_validate': { const r = validate(args.document, { contract: service.contract }); return result(r, !r.valid); }
        case 'ui_fix': { const r = fix(args.document, { contract: service.contract }); return result(r, !r.valid); }
        case 'ui_publish': {
          const surfaceId = args.surfaceId ?? defaultSurfaceId;
          if (!surfaceId) return result({ status: 'error', error: 'NO_SURFACE', message: 'No surfaceId was given and this connection has no default surface.' }, true);
          const r = await service.publish({ principal, surfaceId, documentId: args.documentId, document: args.document, baseRevision: args.baseRevision, reset: args.reset, resolvesEventId: args.resolvesEventId });
          return result(r, r.status !== 'committed');
        }
        case 'ui_read_events':
          return result(await service.readEvents({ principal, surfaceId: args.surfaceId, cursor: args.cursor, limit: args.limit }));
        default:
          return null;
      }
    } catch (error) {
      if (error instanceof UIServiceError) return result({ status: 'error', error: error.code, message: error.message }, true);
      throw error;
    }
  }
  /** Handles one JSON-RPC message; returns the response, or null for notifications. */
  async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return message && 'id' in message && !('method' in message) ? null : { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    const reply = data => ({ jsonrpc: '2.0', id: message.id, ...data });
    if (!('id' in message)) return null;
    try {
      switch (message.method) {
        case 'initialize': {
          const requested = message.params?.protocolVersion;
          return reply({ result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: serverName, version: PACKAGE_VERSION },
            instructions: 'Use ui_get_capabilities to get the contract and generation instructions, then ui_publish to show a validated document. ui_validate and ui_fix are optional preparation.'
          } });
        }
        case 'ping': return reply({ result: {} });
        case 'tools/list': return reply({ result: { tools: mcpTools } });
        case 'tools/call': {
          const output = await callTool(message.params?.name, message.params?.arguments);
          return output ? reply({ result: output }) : reply({ error: { code: -32602, message: `Unknown tool ${message.params?.name}` } });
        }
        default: return reply({ error: { code: -32601, message: `Method not found: ${message.method}` } });
      }
    } catch (error) {
      return reply({ error: { code: -32603, message: 'Internal error' } });
    }
  }
  return { handleMessage, callTool };
}

/** Serves MCP over stdio (newline-delimited JSON-RPC). Logs go to stderr. */
export function serveStdio(handler, { input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let pending = Promise.resolve();
  lines.on('line', line => {
    if (!line.trim()) return;
    pending = pending.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      const messages = Array.isArray(message) ? message : [message];
      const responses = (await Promise.all(messages.map(handler.handleMessage))).filter(Boolean);
      if (responses.length) output.write(JSON.stringify(Array.isArray(message) ? responses : responses[0]) + '\n');
    });
  });
  return { close: () => lines.close(), done: new Promise(resolve => lines.once('close', resolve)) };
}

/**
 * Streamable HTTP transport (stateless, JSON responses). handlerFor(principal) builds the handler for an
 * authenticated principal; requests from origins outside allowedOrigins are rejected.
 */
export function createMCPHttpHandler({ authenticate, handlerFor, path = '/mcp', allowedOrigins = [], maxBodyBytes = 1024 * 1024 }) {
  const origins = new Set(allowedOrigins);
  return async function handle(request, response) {
    const url = new URL(request.url, 'http://mcp');
    if (url.pathname !== path) return false;
    const send = (status, data, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); response.end(data === undefined ? undefined : JSON.stringify(data)); };
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) { send(403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin not allowed' } }); return true; }
    if (request.method !== 'POST') { send(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed; this server is stateless and does not offer a GET stream' } }, { Allow: 'POST' }); return true; }
    const principal = await authenticate(request);
    if (!principal) { send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Authentication required' } }, { 'WWW-Authenticate': 'Bearer' }); return true; }
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > maxBodyBytes) { send(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Body too large' } }); return true; } chunks.push(chunk); }
    let message;
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return true; }
    const handler = handlerFor(principal, request);
    const messages = Array.isArray(message) ? message : [message];
    const responses = (await Promise.all(messages.map(handler.handleMessage))).filter(Boolean);
    if (!responses.length) { send(202); return true; }
    send(200, Array.isArray(message) ? responses : responses[0]);
    return true;
  };
}
