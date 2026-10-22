# Deployment

## Choose an integration path

All paths use the same contract, schemas and validation.

| Path | Agent needs | Use when |
| --- | --- | --- |
| Raw | The contract and instructions added to its prompt; your backend validates | You already have an Agent loop and a backend. |
| Skill | The `skill/intelligence-ui` folder and a CLI, HTTP or MCP connection | The Agent product supports Agent Skills. |
| MCP | An MCP connection to `intelligence-ui mcp` or `/mcp` | The Agent product supports MCP tools. |

Ordinary MCP support does not mean a host can render interactive UI inline. MCP tools publish to a UI surface that your frontend renders; hosts without such a frontend should show a text summary or a link to a page that renders the surface.

## Embed the service in a Node backend

```js
import http from 'node:http';
import { createUIService, MemoryUIStore } from '@haowei2000/intelligence-ui/node';
import { createContract } from '@haowei2000/intelligence-ui/protocol';

const service = createUIService({
  contract: createContract({ actions: [{ id: 'submit-plan', input: 'form' }] }),
  store: new MemoryUIStore(),                        // replace with your database (see UIStore in types/node.d.ts)
  authenticate: request => sessions.principalFor(request),   // { id, roles: ['agent' | 'user'], surfaces: [...] }
  authorize: (principal, { operation, surfaceId }) => acl.allows(principal, operation, surfaceId),
  onEvent: async (event, { principal, surfaceId }) => {
    await queue.enqueue({ event, user: principal.id, surfaceId });   // wake your Agent
    return { status: 'accepted' };
  },
  cors: { origins: ['https://app.example.com'] }
});
http.createServer(async (req, res) => { if (!(await service.handle(req, res))) yourApp(req, res); }).listen(8080);
```

The host owns authentication, authorization, routing and Agent scheduling:

- `authenticate` maps a request to a principal. Agent-supplied ids never select a principal or another user's surface.
- `authorize` decides each operation (`publish`, `read`, `stream`, `event`, `state`, `read-events`, `report-status`, `contract`, `validate`) per surface. The default allows `agent` principals to publish and read events, and `user` principals to read, stream, submit and save state, limited to the principal's `surfaces`.
- `onEvent` runs after the event is re-validated against the committed revision and deduplicated. Recheck business authorization there regardless of document validity.

### Routes

| Method and path | Role | Purpose |
| --- | --- | --- |
| `GET /ui/contract`, `GET /ui/instructions` | any | Deployment contract and generation instructions |
| `POST /ui/validate`, `POST /ui/fix` | any | `{ document }` → result |
| `PUT /ui/surfaces/:surface/documents/:id` | agent | Publish `{ document, baseRevision, reset?, resolvesEventId? }`: 200 committed, 422 rejected, 409 conflict |
| `GET /ui/surfaces/:surface/documents[/:id]` | user, agent | Committed documents with current state |
| `GET /ui/surfaces/:surface/stream` | user | Server-Sent Events delivery |
| `POST /ui/surfaces/:surface/events` | user | Interaction event: 202 with the action result |
| `PUT /ui/surfaces/:surface/documents/:id/state` | user | Save `{ state, baseRevision }` |
| `GET /ui/events?cursor=&surface=` | agent | Event log; the cursor acknowledges earlier events |
| `POST /ui/surfaces/:surface/events/:eventId/status` | agent | Report `succeeded` or `failed` later |

### Stores

`MemoryUIStore` keeps everything in process memory and suits a single instance and tests. `SqliteUIStore` (Node 22.13+, no extra dependency) persists to a file and can be shared by several processes on one machine; with the CLI, set `"store": { "sqlite": "ui.db" }` in the config. For instances on several machines, implement the `UIStore` interface on your database: `commit()` must compare the current revision and write atomically. Events stay retrievable until a later cursor acknowledges them or the retention period (default 24 hours) passes; a read reports `expired: true` instead of silently skipping dropped events.

## Run the standalone service

```sh
npx @haowei2000/intelligence-ui serve --config config.json --port 4320 --host 127.0.0.1
```

`config.json` holds `contract` (createContract options), `tokens` (bearer token → principal, at least 16 characters) and `cors.origins`. The server exposes `/ui`, `/mcp` (Streamable HTTP, stateless, JSON responses) and `/assets/` (browser modules and the Playground). Put it behind TLS. Static tokens are for demos and service accounts; real users should come from your own session system through `createUIService`.

## MCP

- **Local stdio:** `npx @haowei2000/intelligence-ui mcp --surface <id> [--config config.json] [--delivery-port 4321]`. The connection's identity is a local agent bound to that surface. `--delivery-port` also serves the delivery API on 127.0.0.1 so a local frontend can render what the Agent publishes.
- **Remote HTTP:** `POST /mcp` with `Authorization: Bearer <agent token>`. Requests with an `Origin` outside `cors.origins` are rejected. The principal's `defaultSurface` is used when a tool call omits `surfaceId`.

Tools: `ui_get_capabilities`, `ui_validate`, `ui_fix`, `ui_publish`, `ui_read_events`. Validation and fixing are optional: `ui_publish` always validates, so one call is enough for a valid document.

Example client configuration for stdio:

```json
{ "mcpServers": { "intelligence-ui": { "command": "npx", "args": ["-y", "@haowei2000/intelligence-ui", "mcp", "--surface", "demo"] } } }
```

## Frontend

Load `@haowei2000/intelligence-ui/runtime` from your bundle, or serve the package's modules with `createAssetHandler()` (no bundler needed). The runtime needs a Content Security Policy that allows:

- scripts from your origin (no `unsafe-eval`; validators are precompiled);
- styles via `styleNonce` (pass your nonce to `mountUI` or `UIRenderer`) or `style-src 'unsafe-inline'`;
- `img-src` and `frame-src` for the origins in your URL policy;
- `connect-src` for the service.

`examples/protocol/frontend` is a working example with a strict nonce-based policy.

Theme the cards with CSS variables on the container: `--iui-accent`, `--iui-text`, `--iui-muted`, `--iui-border`, `--iui-surface`, `--iui-subtle`, `--iui-danger`, `--iui-success`, `--iui-warning`, `--iui-radius`, `--iui-font`. Cards default to a light palette with `color-scheme: light` so native controls match; for a dark theme set the color variables and `--iui-color-scheme: dark`.
