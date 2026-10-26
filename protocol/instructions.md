# Interactive UI output (protocol 1.0)

These instructions only cover producing an interactive UI document. Contract: `iui-49720ed330790d61`.

## Output

- Produce exactly one JSON object. No Markdown fences, comments, or text around it.
- Shape: `{"schemaVersion":"1.0","root":<component>,"title"?:string,"datasets"?:{...}}`.
- Do not include `id`, `revision`, or `state` at the top level; the host assigns identity, revisions, and user state.

## Rules

- Every component has `type` and an `id` that is unique in the document (letter first, then letters, digits, `-` or `_`, max 64). Keep ids stable when you update a document.
- Use only the components, properties, and actions listed below. Unknown properties are rejected, not ignored.
- Input, Choice, Toggle, and Slider store their value under `bind`. Each bind key is used by exactly one component. Keep bind keys stable across updates so user input is preserved. Set initial values with `default`, never by writing state.
- Text is displayed literally. Do not emit HTML, Markdown, CSS, scripts, or event handlers.
- A Form submits the visible fields inside it to its `submitAction`. Put buttons with `{"type":"submit"}` or `{"type":"reset"}` inside a Form. Forms cannot nest.
- `visibleWhen` shows a component only when a bound field matches: `{"bind":"field","op":"equals","value":"x"}`; ops: equals, notEquals (scalar value), in (array value), empty, notEmpty (no value). It must reference a bind key declared in the document.
- Tables and charts read rows from `datasets`: `{"datasets":{"name":{"rows":[{"field":"value"}]}}}`. Row values are strings, numbers, booleans or null.
- Chart: set kind (bar, line or pie), dataset, x (category field), series ([{field,label}]) and title. Every mapped field must exist in every row. Categories are strings or finite numbers; series values are finite numbers or null. Null means missing: lines break at nulls. Lines use equally spaced categories in row order. Pie requires exactly one series with nonnegative values. Bar/line support up to 8 unique series. Empty data is valid. Charts never call actions; full data is available in a disclosure table.
- URLs are absolute. Images: https from any origin. Links: https/http/mailto from any origin. Web previews: https from any origin.
- Limits: 500 components, depth 16, 1000 rows per dataset, 10000 characters per string, 262144 bytes in total.
- Unsupported content types (raw HTML, Markdown, scripts, embedded applications) have no component. Express the content with the listed components or describe it in Text.

## Actions

This contract does not list actions. Use only action ids given to you by the host; the deployment contract verifies them at publication.

## Components

### Stack

Arranges children vertically or horizontally.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| direction | "vertical" \| "horizontal" | no | Main axis. default "vertical" |
| gap | "none" \| "small" \| "medium" \| "large" | no | Space between children. default "medium" |
| align | "start" \| "center" \| "end" \| "stretch" | no | Cross axis alignment. default "stretch" |
| wrap | boolean | no | Wrap horizontal children onto new lines. default false |
| children | component[] | yes | Child components. |

### Grid

Places children in equal columns that collapse to one column on narrow screens.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| columns | integer | yes | Column count on wide screens. min 1, max 6 |
| gap | "none" \| "small" \| "medium" \| "large" | no | Space between cells. default "medium" |
| children | component[] | yes | Grid cells. |

### Card

Groups related content under an optional title.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| title | string | no | Card heading. |
| description | string | no | Supporting text under the heading. |
| children | component[] | yes | Card content. |

### Divider

A horizontal separator.

### Text

Plain text. Variants cover headings, body copy, captions and code. Markup is not interpreted.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| text | string | yes | Displayed text. |
| variant | "heading1" \| "heading2" \| "heading3" \| "body" \| "caption" \| "code" | no | Typographic role. default "body" |
| tone | "default" \| "muted" \| "success" \| "warning" \| "danger" | no | Color emphasis. default "default" |

### Image

An image from an allowed URL with a text alternative.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| src | string | yes | Absolute image URL; host policy decides allowed schemes and origins. |
| alt | string | yes | Text alternative. Use an empty string only for purely decorative images. |
| caption | string | no | Visible caption. |
| width | integer | no | Intrinsic width in pixels, used to reserve space. min 1, max 4096 |
| height | integer | no | Intrinsic height in pixels. min 1, max 4096 |

### Link

Navigates to a URL. Use Button for actions.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| href | string | yes | Absolute URL; host policy decides allowed schemes, origins and target. |
| label | string | yes | Link text. |

### Input

Single or multi line entry. kind selects the value type: number stores a number or null, every other kind stores a string.
Stored value: number when kind is number; string when kind is anything else.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| bind | string | yes | Field key in state.values. |
| label | string | yes | Visible label. |
| kind | "text" \| "email" \| "url" \| "tel" \| "number" \| "date" \| "time" | no | Input kind; date is YYYY-MM-DD and time is HH:MM, both stored as strings. default "text" |
| multiline | boolean | no | Multi line entry. Only for kind text. default false |
| placeholder | string | no | Example value shown when empty. |
| description | string | no | Help text. |
| required | boolean | no | Must be non empty to submit. default false |
| minLength | integer | no | Minimum characters. Not for kind number. min 0, max 10000 |
| maxLength | integer | no | Maximum characters. Not for kind number. min 1, max 10000 |
| min | number | no | Minimum value. Only for kind number. |
| max | number | no | Maximum value. Only for kind number. |
| step | number | no | Value granularity. Only for kind number. > 0 |
| default | string \| number \| null | no | Initial value when the user has none: a string, or a number or null for kind number. |

### Choice

Single or multiple selection from options. mode single stores a string (empty string when nothing is selected); mode multiple stores an array of strings.
Stored value: string when mode is single; string[] when mode is multiple.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| bind | string | yes | Field key in state.values. |
| label | string | yes | Visible group label. |
| mode | "single" \| "multiple" | yes | Selection mode. |
| display | "buttons" \| "radio" \| "checkbox" \| "select" | no | Presentation. radio is single only, checkbox is multiple only. Defaults to radio for single and checkbox for multiple. |
| options | object[] | yes | Options with unique values. at least 1 items, at most 100 items, items: {value, label, description?} |
| description | string | no | Help text. |
| required | boolean | no | Single: a value must be selected. Multiple: at least one, unless minSelected says otherwise. default false |
| minSelected | integer | no | Minimum selections. Only for mode multiple. min 0, max 100 |
| maxSelected | integer | no | Maximum selections. Only for mode multiple. min 1, max 100 |
| default | string \| string[] | no | Initial value: an option value for single, an array of option values for multiple. at most 100 items |

### Toggle

An on or off setting. Stores a boolean.
Stored value: boolean.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| bind | string | yes | Field key in state.values. |
| label | string | yes | Visible label. |
| description | string | no | Help text. |
| default | boolean | no | Initial value. default false |

### Slider

Selects a number in a bounded range. Stores a number.
Stored value: number.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| bind | string | yes | Field key in state.values. |
| label | string | yes | Visible label. |
| min | number | yes | Lower bound. |
| max | number | yes | Upper bound; greater than min. |
| step | number | no | Increment; not larger than max - min. > 0 default 1 |
| description | string | no | Help text. |
| default | number | no | Initial value within the bounds. Defaults to min. |

### Form

Submission scope. Submitting sends the values of the visible fields inside the form to submitAction. Forms cannot nest.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| submitAction | string | yes | Registered host action that receives the submitted values. |
| children | component[] | yes | Fields and buttons. |

### Button

Runs an action. submit and reset act on the enclosing Form; action calls a registered host action without form values.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| label | string | yes | Button text. |
| action | object | yes | {"type":"submit"}, {"type":"reset"} or {"type":"action","actionId":"<registered action>"}. |
| variant | "primary" \| "secondary" \| "danger" | no | Emphasis. Defaults to primary for submit and secondary otherwise. |

### Tabs

Switches between panels locally. Tab switching never calls the host.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| label | string | no | Accessible name for the tab list. |
| tabs | object[] | yes | Tabs with unique ids. at least 1 items, at most 20 items, items: {id, label, children} |
| defaultTab | string | no | Initially active tab id. Defaults to the first tab. |

### Disclosure

Content that the user can expand and collapse locally.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| label | string | yes | Toggle text and accessible name. |
| defaultOpen | boolean | no | Initially expanded. default false |
| children | component[] | yes | Collapsible content. |

### Table

Shows rows from a dataset. Sorting is local.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| dataset | string | yes | Name of a dataset in the document's datasets. |
| columns | object[] | yes | Columns with unique fields. format number requires numeric values or null. at least 1 items, at most 20 items, items: {field, label, format?} |
| rowKey | string | no | Field whose values identify rows uniquely. |
| sortable | boolean | no | Allow local sorting by column. default false |
| caption | string | no | Table caption. |
| emptyText | string | no | Shown when the dataset has no rows. |

### Chart

Accessible SVG bar, line or pie chart from a dataset. Charts are local displays and never call the host.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| kind | "bar" \| "line" \| "pie" | yes | Grouped bars, lines with gaps for null values, or pie slices. Pie requires exactly one series and nonnegative values. |
| dataset | string | yes | Name of a dataset in the document. |
| x | string | yes | Category field. Every row must contain a string or finite number. Rows keep dataset order; line points are equally spaced. |
| series | object[] | yes | Unique numeric fields and their legend labels. Every mapped value must be a finite number or null. Null means missing, never zero. at least 1 items, at most 8 items, items: {field, label} |
| title | string | yes | Visible heading and accessible chart name. |
| description | string | no | Optional explanation below the heading. |
| height | integer | no | Chart height in pixels; width adapts to the container. min 200, max 600 default 300 |
| showLegend | boolean | no | Show series labels, or category labels for pie slices. Full data remains available in the data table. default true |
| emptyText | string | no | Shown for empty or entirely null data, or a pie with no positive values. |

### WebPreview

Embeds an external page in a sandboxed frame with an open original link. Sites may refuse embedding; the link always remains.

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| url | string | yes | Absolute URL; host policy decides allowed origins and sandbox. |
| title | string | yes | Frame title and link text. |
| height | integer | no | Frame height in pixels. min 200, max 1200 default 480 |

## Example

```json
{
  "schemaVersion": "1.0",
  "root": {
    "type": "Card",
    "id": "trip-card",
    "title": "Trip plan",
    "children": [
      {
        "type": "Form",
        "id": "trip-form",
        "submitAction": "submit-plan",
        "children": [
          {
            "type": "Choice",
            "id": "destination-choice",
            "bind": "destination",
            "label": "Destination",
            "mode": "single",
            "display": "buttons",
            "default": "berlin",
            "options": [
              {
                "value": "berlin",
                "label": "Berlin"
              },
              {
                "value": "paris",
                "label": "Paris"
              }
            ]
          },
          {
            "type": "Button",
            "id": "submit-trip",
            "label": "Continue",
            "action": {
              "type": "submit"
            }
          }
        ]
      }
    ]
  }
}
```
