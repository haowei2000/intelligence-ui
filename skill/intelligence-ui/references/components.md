# Component reference

Generated from `protocol/components.json` (protocol 1.0). Every component also accepts `type`, a unique `id`, and an optional `visibleWhen` condition.

| Component | Category | Purpose |
| --- | --- | --- |
| [Stack](#stack) | layout | Arranges children vertically or horizontally. |
| [Grid](#grid) | layout | Places children in equal columns that collapse to one column on narrow screens. |
| [Card](#card) | layout | Groups related content under an optional title. |
| [Divider](#divider) | layout | A horizontal separator. |
| [Text](#text) | content | Plain text. Variants cover headings, body copy, captions and code. Markup is not interpreted. |
| [Image](#image) | content | An image from an allowed URL with a text alternative. |
| [Link](#link) | content | Navigates to a URL. Use Button for actions. |
| [Input](#input) | input | Single or multi line entry. kind selects the value type: number stores a number or null, every other kind stores a string. |
| [Choice](#choice) | input | Single or multiple selection from options. mode single stores a string (empty string when nothing is selected); mode multiple stores an array of strings. |
| [Toggle](#toggle) | input | An on or off setting. Stores a boolean. |
| [Slider](#slider) | input | Selects a number in a bounded range. Stores a number. |
| [Form](#form) | form | Submission scope. Submitting sends the values of the visible fields inside the form to submitAction. Forms cannot nest. |
| [Button](#button) | form | Runs an action. submit and reset act on the enclosing Form; action calls a registered host action without form values. |
| [Tabs](#tabs) | organization | Switches between panels locally. Tab switching never calls the host. |
| [Disclosure](#disclosure) | organization | Content that the user can expand and collapse locally. |
| [Table](#table) | data | Shows rows from a dataset. Sorting is local. |
| [WebPreview](#webpreview) | external | Embeds an external page in a sandboxed frame with an open original link. Sites may refuse embedding; the link always remains. |

## Stack

Arranges children vertically or horizontally.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `direction` | `"vertical" \| "horizontal"` | no | `"vertical"` | Main axis. |
| `gap` | `"none" \| "small" \| "medium" \| "large"` | no | `"medium"` | Space between children. |
| `align` | `"start" \| "center" \| "end" \| "stretch"` | no | `"stretch"` | Cross axis alignment. |
| `wrap` | `boolean` | no | `false` | Wrap horizontal children onto new lines. |
| `children` | `Component[]` | yes |  | Child components. |

```json
{
  "type": "Stack",
  "id": "actions",
  "direction": "horizontal",
  "children": [
    {
      "type": "Text",
      "id": "hello",
      "text": "Hello"
    }
  ]
}
```

## Grid

Places children in equal columns that collapse to one column on narrow screens.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `columns` | `number` | yes |  | Column count on wide screens. |
| `gap` | `"none" \| "small" \| "medium" \| "large"` | no | `"medium"` | Space between cells. |
| `children` | `Component[]` | yes |  | Grid cells. |

```json
{
  "type": "Grid",
  "id": "stats",
  "columns": 2,
  "children": [
    {
      "type": "Text",
      "id": "a",
      "text": "A"
    },
    {
      "type": "Text",
      "id": "b",
      "text": "B"
    }
  ]
}
```

## Card

Groups related content under an optional title.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `title` | `string` | no |  | Card heading. |
| `description` | `string` | no |  | Supporting text under the heading. |
| `children` | `Component[]` | yes |  | Card content. |

```json
{
  "type": "Card",
  "id": "summary",
  "title": "Summary",
  "children": []
}
```

## Divider

A horizontal separator.

```json
{
  "type": "Divider",
  "id": "rule"
}
```

## Text

Plain text. Variants cover headings, body copy, captions and code. Markup is not interpreted.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | `string` | yes |  | Displayed text. |
| `variant` | `"heading1" \| "heading2" \| "heading3" \| "body" \| "caption" \| "code"` | no | `"body"` | Typographic role. |
| `tone` | `"default" \| "muted" \| "success" \| "warning" \| "danger"` | no | `"default"` | Color emphasis. |

```json
{
  "type": "Text",
  "id": "title",
  "text": "Trip plan",
  "variant": "heading2"
}
```

## Image

An image from an allowed URL with a text alternative.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `src` | `string` | yes |  | Absolute image URL; host policy decides allowed schemes and origins. |
| `alt` | `string` | yes |  | Text alternative. Use an empty string only for purely decorative images. |
| `caption` | `string` | no |  | Visible caption. |
| `width` | `number` | no |  | Intrinsic width in pixels, used to reserve space. |
| `height` | `number` | no |  | Intrinsic height in pixels. |

```json
{
  "type": "Image",
  "id": "cover",
  "src": "https://example.com/berlin.jpg",
  "alt": "Brandenburg Gate at dusk"
}
```

## Link

Navigates to a URL. Use Button for actions.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `href` | `string` | yes |  | Absolute URL; host policy decides allowed schemes, origins and target. |
| `label` | `string` | yes |  | Link text. |

```json
{
  "type": "Link",
  "id": "guide",
  "href": "https://example.com/guide",
  "label": "Travel guide"
}
```

## Input

Single or multi line entry. kind selects the value type: number stores a number or null, every other kind stores a string.

Stored value: kind number: number, kind other: string.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bind` | `string` | yes |  | Field key in state.values. |
| `label` | `string` | yes |  | Visible label. |
| `kind` | `"text" \| "email" \| "url" \| "tel" \| "number" \| "date" \| "time"` | no | `"text"` | Input kind; date is YYYY-MM-DD and time is HH:MM, both stored as strings. |
| `multiline` | `boolean` | no | `false` | Multi line entry. Only for kind text. |
| `placeholder` | `string` | no |  | Example value shown when empty. |
| `description` | `string` | no |  | Help text. |
| `required` | `boolean` | no | `false` | Must be non empty to submit. |
| `minLength` | `number` | no |  | Minimum characters. Not for kind number. |
| `maxLength` | `number` | no |  | Maximum characters. Not for kind number. |
| `min` | `number` | no |  | Minimum value. Only for kind number. |
| `max` | `number` | no |  | Maximum value. Only for kind number. |
| `step` | `number` | no |  | Value granularity. Only for kind number. |
| `default` | `string \| number \| null` | no |  | Initial value when the user has none: a string, or a number or null for kind number. |

```json
{
  "type": "Input",
  "id": "name-input",
  "bind": "name",
  "label": "Your name",
  "required": true
}
```

## Choice

Single or multiple selection from options. mode single stores a string (empty string when nothing is selected); mode multiple stores an array of strings.

Stored value: mode single: string, mode multiple: string[].

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bind` | `string` | yes |  | Field key in state.values. |
| `label` | `string` | yes |  | Visible group label. |
| `mode` | `"single" \| "multiple"` | yes |  | Selection mode. |
| `display` | `"buttons" \| "radio" \| "checkbox" \| "select"` | no |  | Presentation. radio is single only, checkbox is multiple only. Defaults to radio for single and checkbox for multiple. |
| `options` | `Array<{ value: string; label: string; description?: string }>` | yes |  | Options with unique values. |
| `description` | `string` | no |  | Help text. |
| `required` | `boolean` | no | `false` | Single: a value must be selected. Multiple: at least one, unless minSelected says otherwise. |
| `minSelected` | `number` | no |  | Minimum selections. Only for mode multiple. |
| `maxSelected` | `number` | no |  | Maximum selections. Only for mode multiple. |
| `default` | `string \| Array<string>` | no |  | Initial value: an option value for single, an array of option values for multiple. |

```json
{
  "type": "Choice",
  "id": "destination-choice",
  "bind": "destination",
  "label": "Destination",
  "mode": "single",
  "display": "buttons",
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
}
```

## Toggle

An on or off setting. Stores a boolean.

Stored value: boolean.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bind` | `string` | yes |  | Field key in state.values. |
| `label` | `string` | yes |  | Visible label. |
| `description` | `string` | no |  | Help text. |
| `default` | `boolean` | no | `false` | Initial value. |

```json
{
  "type": "Toggle",
  "id": "notify-toggle",
  "bind": "notify",
  "label": "Email me updates"
}
```

## Slider

Selects a number in a bounded range. Stores a number.

Stored value: number.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bind` | `string` | yes |  | Field key in state.values. |
| `label` | `string` | yes |  | Visible label. |
| `min` | `number` | yes |  | Lower bound. |
| `max` | `number` | yes |  | Upper bound; greater than min. |
| `step` | `number` | no | `1` | Increment; not larger than max - min. |
| `description` | `string` | no |  | Help text. |
| `default` | `number` | no |  | Initial value within the bounds. Defaults to min. |

```json
{
  "type": "Slider",
  "id": "budget-slider",
  "bind": "budget",
  "label": "Budget (EUR)",
  "min": 100,
  "max": 2000,
  "step": 50,
  "default": 800
}
```

## Form

Submission scope. Submitting sends the values of the visible fields inside the form to submitAction. Forms cannot nest.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `submitAction` | `string` | yes |  | Registered host action that receives the submitted values. |
| `children` | `Component[]` | yes |  | Fields and buttons. |

```json
{
  "type": "Form",
  "id": "trip-form",
  "submitAction": "submit-plan",
  "children": [
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
```

## Button

Runs an action. submit and reset act on the enclosing Form; action calls a registered host action without form values.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `label` | `string` | yes |  | Button text. |
| `action` | `{ type: "submit" \| "reset" \| "action"; actionId?: string }` | yes |  | {"type":"submit"}, {"type":"reset"} or {"type":"action","actionId":"<registered action>"}. |
| `variant` | `"primary" \| "secondary" \| "danger"` | no |  | Emphasis. Defaults to primary for submit and secondary otherwise. |

```json
{
  "type": "Button",
  "id": "refresh",
  "label": "Refresh prices",
  "action": {
    "type": "action",
    "actionId": "refresh-prices"
  }
}
```

## Tabs

Switches between panels locally. Tab switching never calls the host.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `label` | `string` | no |  | Accessible name for the tab list. |
| `tabs` | `Array<{ id: string; label: string; children: Component[] }>` | yes |  | Tabs with unique ids. |
| `defaultTab` | `string` | no |  | Initially active tab id. Defaults to the first tab. |

```json
{
  "type": "Tabs",
  "id": "details-tabs",
  "tabs": [
    {
      "id": "overview",
      "label": "Overview",
      "children": []
    },
    {
      "id": "costs",
      "label": "Costs",
      "children": []
    }
  ]
}
```

## Disclosure

Content that the user can expand and collapse locally.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `label` | `string` | yes |  | Toggle text and accessible name. |
| `defaultOpen` | `boolean` | no | `false` | Initially expanded. |
| `children` | `Component[]` | yes |  | Collapsible content. |

```json
{
  "type": "Disclosure",
  "id": "more",
  "label": "More details",
  "children": []
}
```

## Table

Shows rows from a dataset. Sorting is local.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `dataset` | `string` | yes |  | Name of a dataset in the document's datasets. |
| `columns` | `Array<{ field: string; label: string; format?: "text" \| "number" \| "date" }>` | yes |  | Columns with unique fields. format number requires numeric values or null. |
| `rowKey` | `string` | no |  | Field whose values identify rows uniquely. |
| `sortable` | `boolean` | no | `false` | Allow local sorting by column. |
| `caption` | `string` | no |  | Table caption. |
| `emptyText` | `string` | no |  | Shown when the dataset has no rows. |

```json
{
  "type": "Table",
  "id": "hotel-table",
  "dataset": "hotels",
  "rowKey": "name",
  "columns": [
    {
      "field": "name",
      "label": "Hotel"
    },
    {
      "field": "price",
      "label": "Price",
      "format": "number"
    }
  ]
}
```

## WebPreview

Embeds an external page in a sandboxed frame with an open original link. Sites may refuse embedding; the link always remains.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | `string` | yes |  | Absolute URL; host policy decides allowed origins and sandbox. |
| `title` | `string` | yes |  | Frame title and link text. |
| `height` | `number` | no | `480` | Frame height in pixels. |

```json
{
  "type": "WebPreview",
  "id": "map-preview",
  "url": "https://example.com/map",
  "title": "Route map"
}
```

## visibleWhen

Show the component only when a bound field matches. equals/notEquals take a scalar value, in takes an array, empty/notEmpty take no value.

```json
{ "bind": "destination", "op": "equals", "value": "berlin" }
```
