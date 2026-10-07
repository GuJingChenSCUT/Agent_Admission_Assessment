import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const schema = JSON.parse(fs.readFileSync(new URL('../docs/design/contracts/domain.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv); ajv.addSchema(schema);
const validators = new Map();
export function validateDefinition(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: 'urn:agent-admission:domain:v1#/$defs/' + name }));
  const validate = validators.get(name), valid = Boolean(validate(value));
  return { valid, errors: valid ? [] : (validate.errors || []).map(e => ({ path: e.instancePath, message: e.message })) };
}
export const validateTaskSpec = value => validateDefinition('TaskSpec', value);

