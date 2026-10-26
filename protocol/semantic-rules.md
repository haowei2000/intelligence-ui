# Semantic rules (protocol 1.0)

JSON Schema (`ui-document.schema.json`) checks structure only. A conforming validator also applies the rules below, in this order, and must agree with `conformance/cases.json` on acceptance and on the listed diagnostic codes. Report independent errors together; stop at the limits in the contract and report truncation.

Every diagnostic has `code`, `path` (JSON Pointer into the candidate), `severity` (`error`, `warning`, `info`) and `message`. A candidate is valid when it has no `error` diagnostics.

## 1. Parsing

| Code | Rule |
| --- | --- |
| `INPUT_TOO_LARGE` | UTF-8 size of the text, or of the serialized object, exceeds `limits.maxBytes`. Stop. |
| `INPUT_UNSUPPORTED` | Input is not a JSON object or JSON text. Stop. |
| `BYTE_ORDER_MARK` | Text starts with U+FEFF. Continue after removing it. |
| `MARKDOWN_FENCE` | The whole text is one Markdown code fence. Continue with the fenced content. |
| `PARSE_INCOMPLETE` | JSON is invalid and ends inside a string or with unclosed brackets. Stop. Never repaired. |
| `PARSE_ERROR` | Any other JSON syntax error. Stop. |

## 2. Version

`schemaVersion` is `major.minor`. A different major, or a minor above the contract's, is `UNSUPPORTED_PROTOCOL_VERSION`.

## 3. Structure

Validate the top level, then each component one at a time with its component schema (children are checked as separate nodes). Map schema failures to:

| Code | Schema failure |
| --- | --- |
| `MISSING_PROPERTY` | `required` |
| `UNKNOWN_PROPERTY` | `additionalProperties` |
| `WRONG_TYPE` | `type` |
| `INVALID_ENUM` | `enum` |
| `INVALID_VALUE` | `const` and other keywords |
| `INVALID_FORMAT` | `pattern` |
| `INVALID_KEY` | `propertyNames` |
| `OUT_OF_RANGE` | minimum, maximum, length, item and property count keywords |

Traversal is depth first in document order: `root`, then `children` in order, then each tab's `children` in order.

| Code | Rule |
| --- | --- |
| `WRONG_TYPE` | A child is not an object. |
| `MISSING_PROPERTY` | A component has no string `type`. |
| `UNKNOWN_COMPONENT` | The type is neither standard nor a registered extension. Implementations may add alternatives and an advisory `proposedPatch`. |
| `COMPONENT_UNAVAILABLE` | A standard type that the contract does not enable. |
| `LIMIT_DEPTH` | Depth (root = 1) exceeds `limits.maxDepth`. Do not descend further. |
| `LIMIT_COMPONENTS` | More than `limits.maxComponents` nodes. Stop traversal and mark the result truncated. |
| `LIMIT_STRING_LENGTH` | Any string property of a component exceeds `limits.maxStringLength`. |
| `LIMIT_DATASETS` / `LIMIT_DATASET_ROWS` | More than `limits.maxDatasets` datasets, or more than `limits.maxDatasetRows` rows in one dataset. |

Before any traversal, raw JSON nesting deeper than `4 × limits.maxDepth + 8` levels is rejected with `LIMIT_DEPTH` at the root, so no implementation needs unbounded recursion.

## 4. Identity and bindings

| Code | Rule |
| --- | --- |
| `DUPLICATE_ID` | Component ids are unique in the document. Report the later occurrence. |
| `DUPLICATE_BINDING` | Each `bind` key belongs to exactly one Input, Choice, Toggle or Slider. |
| `UNSAFE_KEY` | `__proto__`, `constructor` and `prototype` are rejected as bind keys, dataset names and row fields. |

Field value types: Input stores `number` (or null) when `kind` is `number`, otherwise `string`. Choice stores `string` for `mode: single` (empty string means no selection) and `string[]` for `mode: multiple`. Toggle stores `boolean`. Slider stores `number`.

## 5. Component rules

| Code | Rule |
| --- | --- |
| `PROPERTY_NOT_APPLICABLE` | Input: `multiline` only with kind text; `min`/`max`/`step` only with kind number; `minLength`/`maxLength` not with kind number. Choice: `minSelected`/`maxSelected` only with mode multiple. Button: `actionId` only with type action. |
| `INVALID_RANGE` | `min > max`, `minLength > maxLength`, `minSelected > maxSelected`, or `minSelected` above the option count. |
| `INVALID_DEFAULT` | The default does not have the field's value type, is outside numeric bounds, is not an option value (or a unique array of option values), or is not `YYYY-MM-DD` / `HH:MM` for date and time inputs. |
| `DUPLICATE_OPTION_VALUE` | Option values are unique within a Choice. |
| `INVALID_DISPLAY` | `radio` requires mode single; `checkbox` requires mode multiple. |
| `INVALID_BOUNDS` | Slider `max` must exceed `min`; `step` must not exceed `max - min`. |
| `NESTED_FORM` | A Form inside another Form. |
| `BUTTON_OUTSIDE_FORM` | A submit or reset Button that is not inside a Form. |
| `MISSING_PROPERTY` | A Button with action type `action` and no `actionId`. |
| `FORM_WITHOUT_SUBMIT` (warning) | A Form with no submit Button. |
| `DUPLICATE_TAB_ID` / `UNKNOWN_TAB` | Tab ids are unique within Tabs; `defaultTab` names one of them. |
| `UNKNOWN_DATASET` | A Table or Chart names a dataset that does not exist. |
| `DUPLICATE_COLUMN` | Column fields are unique within a Table. |
| `INVALID_DATASET_VALUE` | A `format: number` column has a value that is not a number or null. Report the first row. |
| `MISSING_ROW_KEY` / `DUPLICATE_ROW_KEY` | With `rowKey`, every row has a non-null, unique value. Report the first problem. |
| `UNUSED_DATASET` (warning) | A dataset no Table or Chart uses. |

Chart additionally applies these rules:

- `DUPLICATE_SERIES`: series fields must be unique.
- `INVALID_CHART_SERIES`: pie charts require exactly one series.
- `INVALID_DATASET_VALUE`: every row must have the mapped category field (string or finite number) and each mapped series field (finite number or null). Pie values must be nonnegative. Report the first invalid row for each mapping. Missing fields are errors; null numeric values mean missing data.
- Empty datasets are valid. Bar and line charts include zero in the numeric axis; negative values are supported. Lines use equally spaced categories in dataset order and break at nulls. Pie ignores null/zero slices and displays an empty state if there are no positive values. Values are never silently coerced or repaired.

## 6. Conditions

`visibleWhen` must reference a declared bind key (`UNKNOWN_BINDING`). `equals`/`notEquals` take a scalar, `in` an array, `empty`/`notEmpty` no value, and values must match the field's scalar type; `string[]` fields compare with strings (`INVALID_CONDITION`).

Evaluation: `equals` on a `string[]` field means "contains"; `in` means "the value, or any selected value, is in the list"; `empty` is true for `''`, `null`, `[]` and missing values. A component is visible when its own condition and every ancestor's condition hold.

## 7. Capabilities

With a deployment contract, `Form.submitAction` and `Button.action.actionId` must be registered (`UNREGISTERED_ACTION`). An action with `input: none` cannot be a submitAction, and one with `input: form` cannot be a Button action (`ACTION_INPUT_MISMATCH`). The standard profile has `actions: null`; validators report `ACTIONS_NOT_VERIFIED` (info) instead.

## 8. URL policy

Image `src`, Link `href` and WebPreview `url` are checked against `policy.urls.<image|link|webPreview>`:

| Code | Rule |
| --- | --- |
| `POLICY_URL_INVALID` | Not an absolute URL. |
| `POLICY_URL_SCHEME` | Scheme not listed. `data:` is only for images and only base64 PNG, JPEG, GIF, WebP or AVIF. |
| `POLICY_URL_CREDENTIALS` | The URL contains a user name or password. |
| `POLICY_URL_ORIGIN` | Origin not listed. `*` allows any origin; `https://*.example.com` allows subdomains of example.com, not example.com itself. `mailto:` has no origin check. |
| `POLICY_SANDBOX_SAME_ORIGIN` | WebPreview when the sandbox has both `allow-scripts` and `allow-same-origin` and the URL's origin is in `policy.webPreview.hostOrigins`. |

## 9. State and events (host side)

These rules apply to committed documents, not candidates:

- Saved state must only contain declared bind keys with values of the field's type (`checkState`).
- An interaction event must name the current revision (`baseRevision`). Its source must be a Form, a submit Button in a Form, or a Button with a host action. Form events must contain exactly the visible fields of that form, each passing its constraints. Button action events carry no values (`checkEvent`).
- Merging state into a new revision follows the table in `docs/protocol.md`.
