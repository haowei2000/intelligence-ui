# Validation and Autofix

## Results

`validate(input, { contract })` accepts a JSON object or JSON text and never throws on bad input.

```js
const result = validate(text, { contract });
if (result.valid) publish(result.document);       // only valid results have `document`
else showToAgent(result.candidate, result.diagnostics);  // invalid results have `candidate`
```

The two field names are deliberate: code that publishes `result.document` cannot publish an invalid candidate by accident.

Validation runs in stages (parsing, version, structure, identity and bindings, component rules, conditions, capabilities, URL policy) and reports independent errors together. It stops predictably at `limits.maxDiagnostics`, `maxComponents` and `maxDepth`, and sets `truncated: true` when it does.

## Diagnostics

```json
{
  "code": "UNREGISTERED_ACTION",
  "path": "/root/children/0/submitAction",
  "severity": "error",
  "message": "The action is not registered by this host.",
  "expected": { "allowed": ["submit-plan"] },
  "suggestion": "Use a registered action that matches the intended operation, or remove the action.",
  "alternatives": ["submit-plan"]
}
```

| Field | Meaning |
| --- | --- |
| `code` | Stable identifier; the full list is in `protocol/semantic-rules.md`. |
| `path` | JSON Pointer into the candidate (`""` is the whole input). |
| `severity` | `error` blocks publication; `warning` and `info` do not. |
| `expected` | The constraint, for example allowed values or a limit. |
| `suggestion`, `alternatives` | Advice for the Agent. |
| `proposedPatch`, `preconditions` | An advisory JSON Patch; apply it only when the preconditions hold. |
| `autofix` | Present when `fix()` can repair this diagnostic. |

Diagnostics do not copy large or sensitive values from the candidate.

## Deterministic fixes

`fix(input, { contract })` works on a detached copy (your input is never mutated), applies the rules below until nothing changes, and returns the validation result plus `applied`:

| Rule | Repair |
| --- | --- |
| `strip-byte-order-mark` | Removes a leading U+FEFF. |
| `strip-markdown-fence` | Removes one code fence around the whole JSON text. |
| `add-schema-version` | Adds the contract's protocol version when `schemaVersion` is missing. |
| `coerce-numeric-string` | `"12"` becomes `12` where a number is required. |
| `coerce-boolean-string` | `"true"` becomes `true` where a boolean is required. |
| `normalize-enum-case` | `"Vertical"` becomes `"vertical"` when exactly one allowed value matches. |

Each applied change records `rule`, `path`, `reason` and the change (`op`, `value`, `previous`). Running `fix` on its own output changes nothing.

Autofix never:

- invents ids, actions, URLs or business data;
- renames ids, properties or components (`Row` stays `Row`, with a suggestion and a proposed patch);
- replaces an unregistered action with a similar name;
- drops unknown properties or components;
- clears selections or user input;
- repairs malformed or truncated JSON (`PARSE_INCOMPLETE` asks for regeneration);
- widens permissions or URL access.

## Repairs that need reasoning

`repair(input, { contract, model, maxAttempts = 2, signal })` runs `fix`, and while the candidate is invalid calls your `model` callback with `{ candidate, diagnostics, feedback, attempt, signal }`. `feedback` is text you can append to the next Agent turn (`repairFeedback(result)` builds the same text). The loop is bounded (at most 10 attempts), stops on abort, and ends with `status`: `valid`, `max-attempts`, `cancelled` or `model-error`. `history` records every attempt. Deterministic Autofix itself never calls a model or the network.

## From the command line

```sh
npx @haowei2000/intelligence-ui validate card.json --deployment deployment.json   # exit 0 valid, 1 invalid
npx @haowei2000/intelligence-ui fix card.json > fixed.json                        # report on stderr, document on stdout
npx @haowei2000/intelligence-ui fix card.json --write                             # rewrite the file only when asked
npx @haowei2000/intelligence-ui validate - --format json < card.json              # machine readable
```

Exit codes: `0` valid, `1` invalid, `2` usage error, `3` I/O or dependency failure.
