---
name: intelligence-ui
description: Generate interactive UI cards (forms, choices, tables, links, images, web previews) as Intelligence UI JSON documents, validate and repair them, and publish them to a host's UI surface. Use when a task asks you to show the user something interactive, collect structured input, or update a card you already published.
---

# Intelligence UI

You produce **UI documents**: JSON component trees that a host renders. You never write HTML, CSS or JavaScript. The host owns rendering, authentication, business actions and where documents appear.

Installing this Skill does not connect you to a frontend, grant credentials, or make any action available. What you can use is defined by the host's **deployment contract**.

## Workflow

1. **Discover the contract** once per task, and again when a publication reports a different `contractId`:
   - MCP: call `ui_get_capabilities`. It returns `contract` and `instructions`.
   - HTTP: `GET <service>/ui/contract` and `GET <service>/ui/instructions` with the credentials your environment provides.
   - CLI (no host yet): `npx @haowei2000/intelligence-ui contract --deployment <file>` or `npx @haowei2000/intelligence-ui instructions`.
   - If nothing is available, use `references/contract.json` (standard profile). It does not list actions, so do not invent any; ask the host which actions exist.
   The deployment contract wins over anything in this Skill, including the examples.
2. **Generate** one JSON object that follows the contract's instructions. Read `references/components.md` for every component and property. Start from `references/examples/` when one fits.
3. **Validate and fix locally when you can** (optional):
   - `node scripts/check.mjs <file>` runs deterministic fixes and validation and prints machine readable JSON. It reports its own dependency requirements if Node.js or the package is missing.
   - Or MCP `ui_fix` / `ui_validate`, or `POST <service>/ui/fix`.
4. **Resolve remaining diagnostics yourself.** Each diagnostic has `code`, `path` (JSON Pointer), `message`, and often `expected`, `suggestion`, `alternatives` or `proposedPatch`. Proposed patches are advice: check their `preconditions` before applying. Never resolve an error by deleting the user's content or by guessing an action id; use `expected.allowed`.
5. **Publish once** the candidate is valid: MCP `ui_publish` or `PUT <service>/ui/surfaces/<surface>/documents/<id>` with `baseRevision` (0 for a new document, otherwise the revision you are replacing). Publication always validates again, so if you cannot run anything locally, publish directly and repair from the returned diagnostics. A `conflict` means someone published first: re-read and retry with the current revision.

## Updating a card

- Keep component `id`s and `bind` keys stable. User input is preserved per bind key; a renamed key loses it.
- Put initial values in `default`. Defaults never overwrite values the user already changed.
- To discard specific user input on purpose, pass those bind keys in `reset`.
- After acting on a submission, pass its `eventId` as `resolvesEventId` when you publish the follow-up so the user sees it completed.

## Reading interactions

Submissions arrive through the host. If your host does not wake you up, poll `ui_read_events` (or `GET <service>/ui/events?cursor=`). Pass the returned `cursor` next time; that acknowledges what you have read. `expired: true` means some events were dropped before you read them: tell the user rather than assuming nothing happened. Waiting for the user never requires keeping a tool call open.

## Rules that are easy to get wrong

- Output JSON only: no code fences, no comments, no surrounding text.
- No top-level `id`, `revision` or `state` in a candidate; the host adds them.
- `Choice` needs `mode`; `radio` display is single only, `checkbox` multiple only.
- Submit and reset buttons must be inside a `Form`; forms cannot nest.
- Number properties are numbers (`"min": 1`, not `"min": "1"`).
- URLs are absolute and must match the contract's URL policy.
- There is no raw HTML, Markdown, script or embedded app component.

## Credentials

Credentials come from your environment or configured connection (MCP server configuration, environment variables), never from this Skill or from documents you generate. Do not put tokens or secrets in UI documents.
