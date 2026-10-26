# Protocol reference (1.0)

The protocol is JSON. Every artifact below is in `protocol/` and is generated from `protocol/components.json`, which is the single source of truth (`npm run generate`; `npm run check:generated` fails when generated files are stale).

| File | Content |
| --- | --- |
| `components.json` | Component catalog: properties, defaults, value types, slots, aliases. |
| `ui-document.schema.json` | JSON Schema 2020-12 for a candidate document. |
| `interaction-event.schema.json` | Schema for events sent from the UI to the host. |
| `delivery.schema.json` | Committed documents, delivery messages and apply outcomes. |
| `contract.json` | The static standard profile. |
| `instructions.md` | Generation instructions for the standard profile. |
| `semantic-rules.md` | Rules JSON Schema cannot express, with diagnostic codes. |
| `conformance/cases.json` | Accept and reject cases every implementation must agree on. |
| `examples/` | Complete valid documents. |

Three versions are independent: the **protocol version** (`schemaVersion`, currently `1.0`), the **contract identity** (`contract.id`, a fingerprint of a deployment's capabilities) and the **npm package version**. The legacy `manifest.formatVersion` belongs to the 0.2 document format and is unrelated.

## Candidate and committed documents

An Agent writes a **candidate**:

```json
{ "schemaVersion": "1.0", "title": "Trip plan", "root": { "type": "Card", "id": "trip-card", "children": [] }, "datasets": {} }
```

The host turns a valid candidate into a **committed document** by adding identity, revision and user state (`commitDocument` in `@haowei2000/intelligence-ui/protocol`):

```json
{ "id": "trip-plan", "revision": 2, "contractId": "iui-…", "document": { "schemaVersion": "1.0", "root": {} }, "state": { "values": { "destination": "paris" }, "dirty": ["destination"], "archived": [] } }
```

`state.dirty` lists bind keys the user changed. Validation and Autofix never add `id`, `revision` or `state` to a candidate.

## Components

18 standard components; see the generated [component reference](components.md).

| Category | Components |
| --- | --- |
| Layout | Stack, Grid, Card, Divider |
| Content | Text, Image, Link |
| Input | Input, Choice, Toggle, Slider |
| Forms and actions | Form, Button |
| Organization | Tabs, Disclosure |
| Data | Table, Chart |
| External | WebPreview |

Every component has `type`, a document-unique `id`, and optional `visibleWhen`. Chart supports bar, line and pie presentations with dataset mappings, SVG output and an accessible data table.

Hosts may register namespaced extensions (`acme:Map`) with `createContract({ extensions })`, validate them with `compileExtensions(contract)` and render them with `mountUI({ renderers })`. An extension is only usable when all three are present.

## Bindings and values

Input, Choice, Toggle and Slider store their value in `state.values[bind]`. Bind keys are flat (`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`), and each belongs to exactly one component.

| Component | Value |
| --- | --- |
| Input, kind `number` | number or null |
| Input, other kinds | string (`date` is `YYYY-MM-DD`, `time` is `HH:MM`) |
| Choice, mode `single` | string; `""` means nothing selected |
| Choice, mode `multiple` | string array in option order |
| Toggle | boolean |
| Slider | number |

Initial values come from `default`. A Slider without a default starts at `min`.

## Forms, actions and events

A Form submits the **visible** fields inside it to its `submitAction`. Buttons are `{ "type": "submit" }` and `{ "type": "reset" }` inside a Form, or `{ "type": "action", "actionId": "…" }` anywhere (no values). Action ids must be registered in the deployment contract. An action's `input` restricts it to forms (`form`), buttons (`none`) or both (`any`).

Submitting produces an interaction event:

```json
{ "eventId": "9f1c…", "documentId": "trip-plan", "baseRevision": 1, "sourceId": "submit-trip", "actionId": "submit-plan", "values": { "destination": "paris" } }
```

The host must re-validate events against the committed revision (`checkEvent`): the revision must be current, the source must run that action, and the values must be exactly the form's visible fields with valid values. Deduplicate by `eventId`, then authorize and execute.

Action results have three states: `accepted` (received; nothing executed yet), `succeeded` and `failed`. A host can report `accepted` immediately and push the final status later as an `action.status` delivery message; publishing a follow-up document with `resolvesEventId` marks the event succeeded. Waiting for a user never keeps a model tool call open.

## Delivery

Delivery is independent of the Agent transport. The bundled service delivers over Server-Sent Events (`GET /ui/surfaces/:surface/stream`) with these messages:

| Message | Meaning |
| --- | --- |
| `document.committed` | A committed document or a new revision. Sent for every document on connect. |
| `action.status` | Status of an interaction event. |
| `document.proposed` | Reserved for candidates shown for review; not rendered as live UI. |

The runtime's `apply()` returns an explicit outcome:

| Outcome | When |
| --- | --- |
| `applied` | A new revision was merged. Includes merge outcomes. |
| `unchanged` | Same revision and content (for example, a reconnect). |
| `stale` | Older than the rendered revision; ignored. |
| `conflict` | Same revision number with different content; ignored. |
| `rejected` | Invalid envelope or document; the last valid document stays. |
| `unsupported-protocol` | Unknown protocol major. |
| `incompatible-capabilities` | Uses components this client's contract does not enable. |

Only complete snapshots are delivered. Patches and incremental batches are not part of 1.0.

## State updates

Input, choice selection, tab switching, disclosure and table sorting run locally. Persistence is optional (`onSave`) and never calls the Agent.

When a new revision arrives, each bind key is merged three ways between the previous revision, the user's local edits and the incoming document:

| Binding situation | Outcome |
| --- | --- |
| Not dirty, still present and type compatible | Take the incoming state value, or the new `default` |
| Dirty, still present and type compatible | Keep the user's value; a new default never replaces it |
| Dirty, but a selected option was removed | Remove that option from the value (single choice becomes `""`), keep the field dirty, archive the old value, report `value-removed` |
| Removed from the incoming document | Archive the value, report `removed` |
| Type changed incompatibly | Archive the value, use the new default, report `type-changed` |
| Listed in `reset` | Discard the local value, use the new default, report `reset` |

Archived values are kept in `state.archived` (at most 1000). Unsaved edits are not cancelled by an update; the pending save is sent with the new revision.

## Contracts

`createContract()` with no arguments is the **standard profile** (`profile: "standard"`). Its `actions` is `null`: validators report `ACTIONS_NOT_VERIFIED` instead of rejecting, and publication validates against the deployment contract. A deployment contract sets `actions`, may restrict `components`, and may tighten `limits` and `policy`.

Agents should cache the contract by `id` and fetch it again when a publication result reports a different `contractId`.
