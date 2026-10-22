# Quick start

This guide shows the full cycle: an Agent produces a UI document, the host validates and publishes it, a browser renders it, and the user's submission comes back to the Agent. It takes about ten minutes and needs Node.js 22 or newer. The Python step also needs Python 3.

## 1. Install

```sh
npm install @haowei2000/intelligence-ui
```

The package has five entries. Applications load only what they import:

| Entry | Use it for |
| --- | --- |
| `@haowei2000/intelligence-ui/protocol` | Contracts, state merge, host-side checks. No DOM or Node APIs. |
| `@haowei2000/intelligence-ui/agent` | `validate`, `fix`, `repair`, `instructions` for Agent backends. |
| `@haowei2000/intelligence-ui/runtime` | `mountUI` and `connectSurface` in the browser. |
| `@haowei2000/intelligence-ui/runtime/react` | `UIRenderer` for React 18 and 19. |
| `@haowei2000/intelligence-ui/node` | The HTTP delivery service, MCP server and stores. |

Developers in other languages need no JavaScript: use the files in `protocol/` (schemas, contract, instructions, conformance cases), the CLI, or the HTTP and MCP services.

## 2. Describe what your host supports

A deployment contract lists the components, actions, limits and URL policy your host accepts:

```js
import { createContract } from '@haowei2000/intelligence-ui/protocol';

export const contract = createContract({
  actions: [{ id: 'submit-plan', input: 'form', description: 'Plans the trip from the submitted preferences.' }],
  policy: { urls: { image: { origins: ['https://images.example.com'] } } }
});
```

The CLI prints the same contract for non-JavaScript tooling: `npx @haowei2000/intelligence-ui contract --deployment deployment.json`.

## 3. Give the Agent the instructions

Add the generated instructions to your Agent's existing system prompt. They are additive and only describe the UI format:

```js
import { instructions } from '@haowei2000/intelligence-ui/agent';
const system = `${yourExistingPrompt}\n\n${instructions(contract)}`;
```

Where your model supports structured output, also pass `protocol/ui-document.schema.json`.

## 4. Validate, fix and repair before publishing

```js
import { fix, repair } from '@haowei2000/intelligence-ui/agent';

const result = await repair(modelOutputText, {
  contract,
  maxAttempts: 2,
  model: ({ feedback, candidate }) => callYourModel([...messages, { role: 'assistant', content: JSON.stringify(candidate) }, { role: 'user', content: feedback }])
});
if (result.valid) publish(result.document);
```

`fix` applies only deterministic repairs (code fences, `"1"` to `1`, enum case, a missing `schemaVersion`) and lists each change. Everything else becomes a diagnostic with a code, a JSON Pointer path and a suggestion. See [Autofix](autofix.md).

## 5. Run the delivery service

The simplest host is the bundled service. Copy `examples/protocol/config.json` and change the tokens:

```sh
npx @haowei2000/intelligence-ui serve --config config.json
```

It serves the delivery API at `/ui`, MCP over HTTP at `/mcp`, and the browser modules at `/assets/`. To embed it in an existing Node backend instead, use `createUIService` (see [Deployment](deployment.md)).

## 6. Render in the browser

```js
import { connectSurface } from '@haowei2000/intelligence-ui/runtime';

connectSurface({
  baseUrl: 'https://api.example.com/ui',
  surfaceId: conversationId,
  container: document.querySelector('#cards'),
  headers: async () => ({ Authorization: `Bearer ${await getSessionToken()}` })
});
```

Or render a committed document yourself:

```js
import { mountUI } from '@haowei2000/intelligence-ui/runtime';

const ui = mountUI(element, {
  document: committed,
  onAction: async event => (await fetch('/actions', { method: 'POST', body: JSON.stringify(event) })).json(),
  onSave: (state, { signal }) => fetch(`/state/${committed.id}`, { method: 'PUT', body: JSON.stringify(state), signal })
});
ui.apply(nextCommittedRevision); // merges, keeping what the user typed
```

React:

```jsx
import { UIRenderer } from '@haowei2000/intelligence-ui/runtime/react';

<UIRenderer document={committed} onAction={sendEvent} onSave={saveState} />
```

The renderer owns form state. Pass newer committed revisions through `document`; do not feed state back into it.

## 7. Try the full cycle locally

In three terminals from a clone of the repository (the examples are not part of the npm package):

```sh
npx @haowei2000/intelligence-ui serve --config examples/protocol/config.json
node examples/protocol/frontend/server.mjs
python3 examples/protocol/agent-python/agent.py
```

Open http://localhost:4331. The Python Agent first makes typical generation errors on purpose, repairs them from diagnostics, publishes a card, and answers your submission with an updated card that keeps your choices. Set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` to use a real OpenAI-compatible model.

To inspect documents without a backend, run `npx @haowei2000/intelligence-ui playground` and open the printed URL.
