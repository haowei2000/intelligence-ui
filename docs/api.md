# API reference

Everything the package exports, grouped by entry point. Type declarations ship with the package, so editors show the full signatures; this page says what each export is for and which one to reach for.

```sh
npm install @haowei2000/intelligence-ui     # Node.js 22 or newer
```

| Entry | Runs in | Import it when you |
| --- | --- | --- |
| [`/agent`](#agent) | Node, Deno, Bun, browsers | Generate documents: instructions for the model, validation, Autofix, repair |
| [`/protocol`](#protocol) | Anywhere | Build contracts, commit documents and check events and state on a host |
| [`/runtime`](#runtime) | Browsers | Render committed documents and connect to the delivery service |
| [`/runtime/react`](#runtimereact) | Browsers with React 18 or 19 | Render with a React component |
| [`/node`](#node) | Node | Run the delivery service, MCP server and stores |
| [CLI](#cli) | Shell, CI | Validate and fix files, print the contract, serve, run MCP |
| [`/protocol/*`](#protocol-files) | Any language | Read the schemas, contract and conformance cases as plain files |

The root entry (`@haowei2000/intelligence-ui`) and `/document`, `/browser` and `/react` serve the earlier InteractiveDocument format and the document studio; they are unchanged in 0.3, and `/node` still exports the studio functions too. See [Migration](migration.md).

## Documents in one minute

The Agent writes a **candidate**: `{ schemaVersion, root, title?, datasets? }`, where `root` is a tree of [components](components.md). The host validates it and commits it, which adds identity and state:

```json
{ "id": "trip", "revision": 1, "contractId": "iui-…", "document": { "schemaVersion": "1.0", "root": { "type": "Text", "id": "hello", "text": "Hello" } }, "state": { "values": {}, "dirty": [] } }
```

The browser renders the **committed document**. The user's input is `state.values`, keyed by each field's `bind`. Submitting a form or pressing an action button sends an **interaction event** `{ eventId, documentId, baseRevision, sourceId, actionId, values }`.

## /agent

```js
import { instructions, validate, fix, repair, repairFeedback } from '@haowei2000/intelligence-ui/agent';
```

| Export | Purpose |
| --- | --- |
| `instructions(contract)` | Text to append to your system prompt. Describes only the components, actions and limits the contract allows. |
| `validate(input, { contract? })` | Checks a candidate. `input` may be an object or the model's raw text. Reports every problem at once. |
| `fix(input, { contract? })` | Applies only [deterministic repairs](autofix.md) on a copy, lists each change in `applied`, then validates. Idempotent. |
| `repair(input, { contract, model, maxAttempts?, signal? })` | Bounded loop: `fix`, then ask `model({ candidate, diagnostics, feedback, attempt, signal })` for a new candidate, up to `maxAttempts` (default 2). |
| `repairFeedback(result)` | The message to send the model after a rejected candidate. |
| `fixRules` | The names and descriptions of the Autofix rules. |
| `compileExtensions(contract)` | Compiles validators for namespaced custom components. Uses Ajv code generation, so call it on the server. |
| `createContract`, `standardContract`, `assertContract` | Re-exported from [`/protocol`](#protocol). |

`validate` and `fix` return a result whose shape tells you whether it is safe to publish:

```ts
{ valid: true,  document: UIDocument, diagnostics, contractId }
{ valid: false, candidate: unknown,   diagnostics, truncated, contractId }   // never has `document`
```

Each diagnostic has a stable `code` (for example `UNKNOWN_COMPONENT`, `UNREGISTERED_ACTION`), a JSON Pointer `path`, a `severity`, a `message`, and where useful `expected`, `suggestion`, `alternatives` and an advisory `proposedPatch`. `fix` adds `applied: [{ rule, path, reason, change }]`. `repair` adds `attempts`, `history` and `status`: `valid`, `max-attempts`, `cancelled` or `model-error`.

```js
const result = await repair(modelText, {
  contract,
  model: async ({ feedback }) => callYourModel([...messages, { role: 'user', content: feedback }])
});
if (result.valid) await publish(result.document);
else log(result.status, result.diagnostics);
```

## /protocol

No DOM or Node APIs; safe in any JavaScript runtime.

| Export | Purpose |
| --- | --- |
| `createContract(options?)` | The deployment contract: `components` (subset to enable), `actions` (`{ id, input: 'form' \| 'none' \| 'any', description? }`), `limits`, `policy.urls` (allowed origins for images, links and previews), `extensions`. Rejects unsafe configuration. |
| `standardContract()` | The static standard profile, identical to `protocol/contract.json`. Actions are not verified. |
| `assertContract(value)` | Checks a contract received from elsewhere. |
| `commitDocument(candidate, { id, revision, previous?, state?, reset?, contractId? })` | Wraps a validated candidate as a committed document and merges the previous state. Returns `{ committed, outcomes }`. |
| `mergeState({ previous, next, local, incoming, reset, revision })` | The three-way state merge used by `commitDocument` and the runtime: values the user changed are kept, removed fields and options are archived. |
| `checkEvent(committed, event, { state? })` | Server-side check of an interaction event against the committed revision: known action, form scope, typed values, conditions. |
| `checkState(document, state)` | Server-side check of saved state. Returns a list of problems. |
| `initialState(document)`, `fieldsOf(document)`, `formFields(document, formId, values)`, `checkField`, `evaluateCondition`, `defaultValue` | Lower-level helpers behind the checks above. |
| `checkUrl(url, resource, policy)`, `sandboxFor(url, policy, pageOrigin?)` | URL policy decisions for images, links and previews. |
| `catalog`, `componentTypes`, `PROTOCOL_VERSION`, `PACKAGE_VERSION` | The component catalog and versions. |
| `canonicalJSON(value)`, `fingerprint(text)` | Stable serialization and the hash used for contract ids. |

If you use the bundled service you rarely need more than `createContract`; the service commits documents and checks events and state for you.

## /runtime

```js
import { connectSurface, mountUI } from '@haowei2000/intelligence-ui/runtime';
```

**`connectSurface(options)`** connects to the delivery service's stream for one surface (for example one conversation), renders each committed document, sends events and saves state. It reconnects automatically.

| Option | Description |
| --- | --- |
| `baseUrl`, `surfaceId`, `container` | Service URL (ending in `/ui`), surface, and the element to render into |
| `headers` | Object or async function, for example a fresh session token |
| `mountOptions` | Settings passed to every `mountUI` call, such as `labels`, `styleNonce`, `contract`, `renderers` |
| `onConnection(status)` | `open`, `retrying` or `closed` |
| `onDelivery(message)`, `onError(error)`, `retryMs`, `fetch` | Hooks and overrides |

It returns `{ controllers, close() }`, where `controllers` maps document ids to the `mountUI` controllers below.

**`mountUI(container, options)`** renders one committed document into a Shadow DOM and returns a controller. Use it when you deliver documents yourself.

| Option | Description |
| --- | --- |
| `document` | The committed document |
| `onAction(event, { signal })` | Called on form submission and action buttons. Resolve with `{ status: 'accepted' \| 'succeeded' \| 'failed', message? }` |
| `onSave(state, { signal, documentId, revision })` | Optional persistence, debounced (`debounceMs`) and serial |
| `onStateChange`, `onMerge`, `onSaveStatus`, `onError` | Observation hooks |
| `contract` | Enables URL policy and capability checks for your deployment (default: standard profile) |
| `readOnly`, `lang`, `labels`, `styleNonce` | Presentation; `styleNonce` lets the runtime work under a nonce-based CSP |
| `renderers`, `extensionValidators` | Trusted renderers for namespaced custom components |

| Controller method | Description |
| --- | --- |
| `apply(nextCommitted, { reset? })` | Applies a newer revision and keeps what the user typed. Returns `{ outcome }`: `applied`, `unchanged`, `stale`, `conflict`, `rejected`, `unsupported-protocol` or `incompatible-capabilities` |
| `getState()`, `getDocument()`, `flush()` | Current state, current document, and a promise that resolves once pending saves finish |
| `setActionStatus(eventId, status, message?)` | Shows a later result for an action |
| `update(settings)`, `destroy()` | Change settings in place; unmount |

Theme the card with `--iui-*` CSS custom properties on the container, such as `--iui-accent`, `--iui-radius` and `--iui-color-scheme`; [Deployment](deployment.md) lists them all.

## /runtime/react

```jsx
import { UIRenderer } from '@haowei2000/intelligence-ui/runtime/react';

<UIRenderer ref={rendererRef} document={committed} onAction={sendEvent} onSave={saveState} />
```

Takes the same options as `mountUI`, plus `className` and `style`. The renderer is uncontrolled: it owns form state, so pass newer committed revisions through `document` and never feed state back in. The ref exposes `getState`, `getDocument`, `flush` and `apply`. React is an optional peer dependency.

## /node

```js
import { createUIService, tokenAuth, MemoryUIStore, SqliteUIStore } from '@haowei2000/intelligence-ui/node';
```

| Export | Purpose |
| --- | --- |
| `createUIService({ contract, store?, authenticate, authorize?, onEvent?, cors?, basePath?, ... })` | The delivery service. `service.handle(req, res)` serves the [HTTP routes](deployment.md#routes) and returns `false` for other paths. It also has `publish`, `submitEvent`, `saveState`, `readEvents`, `reportStatus`, `getDocument` and `subscribe` for direct calls. |
| `tokenAuth(tokens)`, `defaultAuthorize` | Static bearer-token authentication (demos, service accounts) and the default role rules |
| `MemoryUIStore`, `SqliteUIStore(file)` | Stores. Implement the `UIStore` interface for your own database; `commit` must compare and set atomically. |
| `createMCPHandler`, `createMCPHttpHandler`, `serveStdio`, `mcpTools` | The MCP server, for embedding it in your own process |
| `createAssetHandler({ prefix? })` | Serves the browser modules and the Playground without a bundler |
| `UIServiceError` | Thrown by direct calls; carries `status` and `code` |

The full example, with authentication and Agent wake-up, is in [Deployment](deployment.md#embed-the-service-in-a-node-backend).

## CLI

Run with `npx @haowei2000/intelligence-ui <command>`, or `intelligence-ui <command>` once installed.

| Command | Description |
| --- | --- |
| `validate [file \| -] [--deployment file] [--format text\|json]` | Validate a candidate file or standard input |
| `fix [file \| -] [--deployment file] [--format text\|json] [--write \| --out file]` | Apply Autofix; writes only with `--write` or `--out` |
| `contract [--deployment file] [--out file]` | Print the contract |
| `instructions [--deployment file]` | Print the generation instructions |
| `serve --config file [--port n] [--host address]` | Run the delivery service, MCP over HTTP and the browser assets |
| `mcp [--config file] [--surface id] [--delivery-port n]` | Run the MCP server over stdio |
| `playground [--port n]` | Open the Playground locally |

`--deployment` is a JSON file of `createContract` options. `--config` adds `tokens`, `cors.origins` and `store` (for example `{ "sqlite": "ui.db" }`). `validate` and `fix` exit with 0 when valid, 1 when invalid, 2 on usage errors and 3 on I/O errors, so they work as CI checks.

## Protocol files

For other languages, everything is plain JSON and Markdown, published with the package and on this site:

| File | Description |
| --- | --- |
| [`ui-document.schema.json`](../protocol/ui-document.schema.json) | JSON Schema 2020-12 for candidates; usable as a structured output schema |
| [`interaction-event.schema.json`](../protocol/interaction-event.schema.json), [`delivery.schema.json`](../protocol/delivery.schema.json) | Events and delivery messages |
| [`contract.json`](../protocol/contract.json) | The standard profile |
| [`instructions.md`](../protocol/instructions.md) | Generation instructions for the standard profile |
| [`semantic-rules.md`](../protocol/semantic-rules.md) | Rules JSON Schema cannot express |
| [`conformance/cases.json`](../protocol/conformance/cases.json) | Cases every validator must agree on |

A backend in any language can skip local validation and call the service: `POST /ui/validate` and `POST /ui/fix` take `{ "document": ... }`, and `PUT /ui/surfaces/:surface/documents/:id` validates before it publishes. `examples/protocol/agent-python` in the repository is a complete Agent using only the Python standard library.
