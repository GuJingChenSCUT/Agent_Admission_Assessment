import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validateTaskSpec } from '../src/schema.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../docs/design/examples/task_spec.json', import.meta.url), 'utf8'));
const result = validateTaskSpec(fixture);
assert.equal(result.valid, true, JSON.stringify(result.errors));
console.log('domain.schema.json: TaskSpec fixture valid');
