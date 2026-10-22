# Migration guide

## From 0.2 to 0.3

0.3 adds the component protocol beside the existing document format.

**The package name changes** from `intelligence-ui` (installed from a tarball or Git) to `@haowei2000/intelligence-ui` on npm, because `intelligence-ui` on npm belongs to another author. Replace the name in your dependencies and imports; every subpath and API stays the same:

```sh
npm uninstall intelligence-ui && npm install @haowei2000/intelligence-ui
# then: import { mountDocument } from '@haowei2000/intelligence-ui';
```

Apart from the name, nothing you import today changes.

| Import | 0.3 behavior |
| --- | --- |
| `@haowei2000/intelligence-ui`, `@haowei2000/intelligence-ui/browser` | Unchanged: `createDocument`, `mountDocument`, … for the InteractiveDocument format. |
| `@haowei2000/intelligence-ui/react` | Unchanged: the controlled `DocumentRenderer`. |
| `@haowei2000/intelligence-ui/document` | Unchanged. |
| `@haowei2000/intelligence-ui/node` | Unchanged, plus `hash` (moved here in 0.2.x) and the new service, store and MCP exports. |
| CLI `intelligence-ui [--port …]` | Unchanged studio. New subcommands: `contract`, `instructions`, `validate`, `fix`, `serve`, `mcp`, `playground`. |

New entries: `@haowei2000/intelligence-ui/protocol`, `@haowei2000/intelligence-ui/agent`, `@haowei2000/intelligence-ui/runtime`, `@haowei2000/intelligence-ui/runtime/react`.

The renderer fixes made before 0.3 still apply to the legacy path: `update(undefined, settings)` changes only settings, edits made before `onSave` is supplied are saved once it is, and `ui.css` containing `url()`, `@import` or `image-set()` is not applied.

## From 0.1

Node imports moved to `@haowei2000/intelligence-ui/node` in 0.2 (`DocumentStore`, `readReference`, `createStudio`, `startStudio`, `createChatCompletionProvider`). `hash` is exported from `@haowei2000/intelligence-ui/node`, not `@haowei2000/intelligence-ui/document`.

## Moving a document to the component protocol

There is no automatic converter, and arbitrary legacy HTML and CSS cannot be converted to a component tree without loss. Map by meaning:

| Legacy | Component protocol |
| --- | --- |
| `title`, `description` | A `Card` with `title` and `description` |
| `decisions[]` with options | One `Choice` (mode `single`, display `buttons`) per decision, `bind` = decision id |
| `state.selections[decisionId]` | `state.values[decisionId]` |
| `state.notes` | An `Input` with `multiline: true`, `bind: "notes"` |
| `data-field` inputs in `ui.html` | `Input`, `Toggle`, `Choice` or `Slider` with the same `bind` key |
| `state.values` | `state.values` (same key rules, plus per-component types) |
| `ui.css` | Not supported; theme with the `--iui-*` CSS variables on the host element |
| `references`, `analysis` | Not part of the component protocol; keep them in your own storage |

Differences that matter:

- **State ownership.** `DocumentRenderer` is controlled through `value`/`onChange`. `UIRenderer` and `mountUI` own field state: pass committed revisions as `document`, receive changes through `onStateChange` and `onSave`, and do not round-trip state through props.
- **Updates.** The legacy `update()` replaces the document and discards unsaved edits. The new `apply()` merges each binding and keeps what the user typed.
- **Actions.** Submissions go through `onAction` as interaction events and must use action ids registered in the host contract.
