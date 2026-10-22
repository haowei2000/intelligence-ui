/**
 * Compiles validators for a contract's extension components. Runs where code generation is allowed
 * (Node or an Agent backend); browsers use the trusted renderer's own checks instead.
 */
export async function compileExtensions(contract) {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
  const validators = {};
  for (const [type, spec] of Object.entries(contract.components)) {
    if (!spec.extension) continue;
    const properties = { type: { const: type }, id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' }, visibleWhen: { type: 'object' } };
    const required = ['type', 'id'];
    for (const [name, prop] of Object.entries(spec.props)) { properties[name] = prop.schema; if (prop.required) required.push(name); }
    for (const slot of spec.slots) if (slot === 'children') properties.children = { type: 'array' };
    validators[type] = ajv.compile({ type: 'object', additionalProperties: false, required, properties });
  }
  return validators;
}
