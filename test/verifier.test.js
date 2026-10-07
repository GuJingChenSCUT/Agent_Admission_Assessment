import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTask, transition } from '../src/domain.js';
import { verifyProviderResponse } from '../src/verifier.js';

const snapshot = { blockHash: '0x' + '11'.repeat(32), references: [{ balanceWei: '42' }] };
test('accepts only same address, same block and same wei', () => { const task = makeTask({ owner: 'test', text: '核对 0x2222222222222222222222222222222222222222 的 ETH 余额' }); transition(task, 'QUEUED'); const result = verifyProviderResponse({ task, snapshot, service: { id: 'svc_primary', manifestHash: '0x' + '44'.repeat(32) }, response: { balanceWei: '42', observation: { address: task.spec.address, blockHash: snapshot.blockHash } } }); assert.equal(result.passed, true); });
test('rejects a cross-block response before comparing a balance', () => { const task = makeTask({ owner: 'test', text: '核对 0x2222222222222222222222222222222222222222 的 ETH 余额' }); const result = verifyProviderResponse({ task, snapshot, service: { id: 'svc_primary', manifestHash: '0x' + '44'.repeat(32) }, response: { balanceWei: '42', observation: { address: task.spec.address, blockHash: '0x' + '55'.repeat(32) } } }); assert.equal(result.passed, false); assert.equal(result.checks.find(c => c.ruleId === 'snapshot_match').status, 'FAIL'); });
