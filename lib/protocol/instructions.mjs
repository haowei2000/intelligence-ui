import { catalog } from './catalog.mjs';

function typeLabel(schema) {
  if (!schema) return 'any';
  if (schema.items?.$ref === 'Component') return 'component[]';
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  const types = [].concat(schema.type || []);
  return types.map(type => type === 'array' ? `${schema.items?.type === 'object' ? 'object' : [].concat(schema.items?.type || 'any').join('|')}[]` : type === 'integer' ? 'integer' : type).join(' | ') || 'any';
}
function constraints(schema) {
  const parts = [];
  if (schema.minimum !== undefined) parts.push(`min ${schema.minimum}`);
  if (schema.exclusiveMinimum !== undefined) parts.push(`> ${schema.exclusiveMinimum}`);
  if (schema.maximum !== undefined) parts.push(`max ${schema.maximum}`);
  if (schema.minItems) parts.push(`at least ${schema.minItems} items`);
  if (schema.maxItems && schema.items?.$ref !== 'Component') parts.push(`at most ${schema.maxItems} items`);
  if (schema.items?.properties) parts.push(`items: {${Object.keys(schema.items.properties).map(key => (schema.items.required || []).includes(key) ? key : `${key}?`).join(', ')}}`);
  return parts.join(', ');
}

/** Generation instructions for an Agent, derived from a contract. Additive to the host's own instructions. */
export function instructions(contract) {
  const urls = contract.policy.urls;
  const origins = list => list.includes('*') ? 'any origin' : list.join(', ');
  let text = `# Interactive UI output (protocol ${contract.protocolVersion})\n\n`;
  text += `These instructions only cover producing an interactive UI document. Contract: \`${contract.id}\`.\n\n`;
  text += `## Output\n\n`;
  text += `- Produce exactly one JSON object. No Markdown fences, comments, or text around it.\n`;
  text += `- Shape: \`{"schemaVersion":"${contract.protocolVersion}","root":<component>,"title"?:string,"datasets"?:{...}}\`.\n`;
  text += `- Do not include \`id\`, \`revision\`, or \`state\` at the top level; the host assigns identity, revisions, and user state.\n\n`;
  text += `## Rules\n\n`;
  text += `- Every component has \`type\` and an \`id\` that is unique in the document (letter first, then letters, digits, \`-\` or \`_\`, max 64). Keep ids stable when you update a document.\n`;
  text += `- Use only the components, properties, and actions listed below. Unknown properties are rejected, not ignored.\n`;
  text += `- Input, Choice, Toggle, and Slider store their value under \`bind\`. Each bind key is used by exactly one component. Keep bind keys stable across updates so user input is preserved. Set initial values with \`default\`, never by writing state.\n`;
  text += `- Text is displayed literally. Do not emit HTML, Markdown, CSS, scripts, or event handlers.\n`;
  text += `- A Form submits the visible fields inside it to its \`submitAction\`. Put buttons with \`{"type":"submit"}\` or \`{"type":"reset"}\` inside a Form. Forms cannot nest.\n`;
  text += `- \`visibleWhen\` shows a component only when a bound field matches: \`{"bind":"field","op":"equals","value":"x"}\`; ops: equals, notEquals (scalar value), in (array value), empty, notEmpty (no value). It must reference a bind key declared in the document.\n`;
  text += `- Tables and charts read rows from \`datasets\`: \`{"datasets":{"name":{"rows":[{"field":"value"}]}}}\`. Row values are strings, numbers, booleans or null.\n`;
  if (contract.components.Chart) text += `- Chart: set kind (bar, line or pie), dataset, x (category field), series ([{field,label}]) and title. Every mapped field must exist in every row. Categories are strings or finite numbers; series values are finite numbers or null. Null means missing: lines break at nulls. Lines use equally spaced categories in row order. Pie requires exactly one series with nonnegative values. Bar/line support up to 8 unique series. Empty data is valid. Charts never call actions; full data is available in a disclosure table.\n`;
  text += `- URLs are absolute. Images: ${urls.image.schemes.join('/')} from ${origins(urls.image.origins)}. Links: ${urls.link.schemes.join('/')} from ${origins(urls.link.origins)}. Web previews: ${urls.webPreview.schemes.join('/')} from ${origins(urls.webPreview.origins)}.\n`;
  text += `- Limits: ${contract.limits.maxComponents} components, depth ${contract.limits.maxDepth}, ${contract.limits.maxDatasetRows} rows per dataset, ${contract.limits.maxStringLength} characters per string, ${contract.limits.maxBytes} bytes in total.\n`;
  text += `- Unsupported content types (raw HTML, Markdown, scripts, embedded applications) have no component. Express the content with the listed components or describe it in Text.\n\n`;
  text += `## Actions\n\n`;
  if (contract.actions === null) text += `This contract does not list actions. Use only action ids given to you by the host; the deployment contract verifies them at publication.\n\n`;
  else if (!contract.actions.length) text += `No actions are registered. Do not use Form or Button actions.\n\n`;
  else text += contract.actions.map(action => `- \`${action.id}\`${action.input === 'form' ? ' (Form submitAction only)' : action.input === 'none' ? ' (Button action only)' : ''}${action.description ? `: ${action.description}` : ''}`).join('\n') + '\n\n';
  text += `## Components\n\n`;
  for (const [type, spec] of Object.entries(contract.components)) {
    text += `### ${type}\n\n${spec.description}\n`;
    if (spec.binding) text += `Stored value: ${spec.binding.type || Object.entries(spec.binding.map).map(([k, v]) => `${v} when ${spec.binding.byProp} is ${k === '*' ? 'anything else' : k}`).join('; ')}.\n`;
    const props = Object.entries(spec.props);
    if (props.length) {
      text += '\n| Property | Type | Required | Notes |\n| --- | --- | --- | --- |\n';
      for (const [name, prop] of props) {
        const notes = [prop.description, constraints(prop.schema), prop.default !== undefined ? `default ${JSON.stringify(prop.default)}` : ''].filter(Boolean).join(' ').replace(/\|/g, '\\|');
        text += `| ${name} | ${typeLabel(prop.schema).replace(/\|/g, '\\|')} | ${prop.required ? 'yes' : 'no'} | ${notes} |\n`;
      }
    }
    text += '\n';
  }
  const example = exampleFor(contract);
  if (example) text += `## Example\n\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n`;
  return text;
}

// A complete example built only from enabled components and registered actions.
function exampleFor(contract) {
  const has = type => Boolean(contract.components[type]);
  const formAction = contract.actions === null ? 'submit-plan' : contract.actions.find(action => action.input !== 'none')?.id;
  let content = null;
  if (has('Form') && has('Button') && formAction) {
    const fields = has('Choice') ? [{ type: 'Choice', id: 'destination-choice', bind: 'destination', label: 'Destination', mode: 'single', display: 'buttons', default: 'berlin', options: [{ value: 'berlin', label: 'Berlin' }, { value: 'paris', label: 'Paris' }] }]
      : has('Input') ? [{ type: 'Input', id: 'name-input', bind: 'name', label: 'Your name', required: true }] : [];
    content = { type: 'Form', id: 'trip-form', submitAction: formAction, children: [...fields, { type: 'Button', id: 'submit-trip', label: 'Continue', action: { type: 'submit' } }] };
  } else if (has('Text')) content = { type: 'Text', id: 'summary', text: 'Trip plan' };
  const container = has('Card') ? { type: 'Card', id: 'trip-card', title: 'Trip plan' } : has('Stack') ? { type: 'Stack', id: 'trip-stack' } : null;
  const root = container ? { ...container, children: content ? [content] : [] } : content;
  return root ? { schemaVersion: contract.protocolVersion, root } : null;
}

/** Text for the next Agent turn after a rejected candidate. */
export function repairFeedback(result) {
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  let text = `The UI document was rejected with ${errors.length} error${errors.length === 1 ? '' : 's'}${result.truncated ? ' (list truncated)' : ''}. Fix every error and return the complete corrected JSON document only.\n\n`;
  for (const d of errors) {
    text += `- ${d.code} at ${d.path || '/'}: ${d.message}`;
    if (d.expected) text += ` Expected: ${JSON.stringify(d.expected)}.`;
    if (d.suggestion) text += ` ${d.suggestion}`;
    text += '\n';
  }
  if (result.applied?.length) text += `\nAlready fixed automatically: ${result.applied.map(fix => `${fix.rule} at ${fix.path || '/'}`).join(', ')}.\n`;
  return text;
}

export const componentTypes = Object.freeze(Object.keys(catalog.components));
