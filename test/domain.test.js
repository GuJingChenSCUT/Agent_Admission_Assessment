import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, taskSpecFromDraft, makeTask, transition } from '../src/domain.js';

test('parses one Ethereum native balance address without guessing', () => { const draft = parseIntent('核对 0x2222222222222222222222222222222222222222 的 ETH 余额'); assert.equal(draft.intentType, 'NATIVE_BALANCE'); assert.equal(draft.missingFields.length, 0); assert.equal(taskSpecFromDraft(draft).sourceChainId, '1'); });
test('asks for clarification when address is absent or ambiguous', () => { assert.deepEqual(parseIntent('核对 ETH 余额').missingFields, ['address']); assert.deepEqual(parseIntent('核对 0x2222222222222222222222222222222222222222 和 0x3333333333333333333333333333333333333333').missingFields, ['address_selection']); });
test('rejects unsupported scope', () => { assert.equal(parseIntent('查询 USDT transfer').intentType, 'UNSUPPORTED'); });
test('enforces task state transitions', () => { const task = makeTask({ owner: 'test', text: '核对 0x2222222222222222222222222222222222222222 的 ETH 余额' }); transition(task, 'QUEUED'); assert.throws(() => transition(task, 'SUCCEEDED'), /INVALID_STATE_TRANSITION/); });
