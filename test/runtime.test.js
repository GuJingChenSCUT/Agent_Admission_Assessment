import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/store.js';
import { makeTask, hashCanonical } from '../src/domain.js';
import { approve, stop, renewApproval, clarify } from '../src/control.js';
import { runTask, recoverInterrupted, sampleSnapshot } from '../src/runtime.js';
import { Gateway } from '../src/gateway.js';
import { config } from '../src/config.js';
import { validateDefinition } from '../src/schema.js';

const text = '核对 0x2222222222222222222222222222222222222222 的 ETH 余额';
function taskFor(scenario = 'normal', fallback = true) {
  const t = makeTask({ owner: 'owner', text, allowFallback: fallback, scenario, mode: 'SAMPLE' });
  renewApproval(t); approve(t, { revision: t.revision, specHash: t.specHash, approvalNonce: t.approvalNonce }, 'idempotent-123'); return t;
}
for (const [scenario, expected, calls] of [['normal','SUCCEEDED',1], ['stale_primary','SUCCEEDED',2], ['both_fail','FAILED',2], ['reference_conflict','QUARANTINED',0], ['manifest_changed','SUCCEEDED',1], ['optional_missing','SUCCEEDED',1]]) {
  test('SAMPLE: ' + scenario, async t => {
    const store = new TaskStore(':memory:'); t.after(() => store.close()); const task = taskFor(scenario); store.put(task);
    const result = await runTask(task, store, { stepMs: 0 });
    assert.equal(result.status, expected, JSON.stringify(result.events)); assert.equal(result.counters.providerCalls, calls);
    assert.equal(hashCanonical(result.report.report), result.report.reportHash);
    assert.equal(validateDefinition('PublicReport', result.report.report).valid, true);
    assert.equal(result.report.report.subjectHash, hashCanonical(result.report.report.subjects));
    if (scenario === 'stale_primary') {
      assert.equal(result.acceptedFact.serviceId, 'svc_backup'); assert.equal(result.counters.fallbacks, 1);
      assert.equal(result.attempts[0].checks.find(c => c.ruleId === 'balance_match').status, 'NOT_CHECKED');
      assert.equal(result.attempts[0].observation.bindingKind, 'PROVIDER_DECLARED');
    }
    assert.equal(JSON.stringify(result.report).includes('approvalNonce'), false);
  });
}
test('no fallback means one failed candidate only', async t => {
  const store = new TaskStore(':memory:'); t.after(() => store.close()); const task = taskFor('stale_primary', false); store.put(task);
  const result = await runTask(task, store, { stepMs: 0 }); assert.equal(result.status, 'FAILED'); assert.equal(result.counters.providerCalls,1); assert.equal(result.counters.fallbacks,0);
});
test('stop persists and blocks a late worker result', async t => {
  const store = new TaskStore(':memory:'); t.after(() => store.close()); const task = taskFor(); store.put(task);
  const running = runTask(task, store, { stepMs: 20 });
  store.mutate(task.taskId, task.owner, stop); const final = await running;
  assert.equal(final.status, 'CANCELLED'); assert.equal(final.acceptedFact, null); assert.equal(final.counters.providerCalls, 0);
});
test('stop wins after dispatch and keeps consumed budget', async t => {
  const store = new TaskStore(':memory:'); t.after(() => store.close()); const task = taskFor(); store.put(task);
  const running = runTask(task, store, { stepMs: 15 });
  while (store.get(task.taskId,task.owner).counters.providerCalls === 0) await new Promise(r => setTimeout(r,2));
  store.mutate(task.taskId, task.owner, stop); const final = await running;
  assert.equal(final.status,'CANCELLED'); assert.equal(final.counters.providerCalls,1); assert.equal(final.attempts[0].status,'LATE_DISCARDED'); assert.equal(final.acceptedFact,null);
});
test('success committed first is not overwritten by stop', async t => {
  const store=new TaskStore(':memory:'); t.after(()=>store.close()); const task=taskFor(); store.put(task);
  await runTask(task,store,{stepMs:0}); const final=store.mutate(task.taskId,task.owner,stop).task; assert.equal(final.status,'SUCCEEDED'); assert.ok(final.acceptedFact);
});
test('interrupted dispatch is quarantined without replay', t => {
  const store=new TaskStore(':memory:'); t.after(()=>store.close()); const task=taskFor(); task.status='RUNNING'; task.leaseGeneration=1; task.counters.providerCalls=1; store.put(task);
  recoverInterrupted(store); const result=store.get(task.taskId,task.owner); assert.equal(result.status,'QUARANTINED'); assert.equal(result.counters.providerCalls,1); assert.equal(result.leaseGeneration,2);
});
test('transaction rollback does not leave mutated in-memory state', t => {
  const store=new TaskStore(':memory:'); t.after(()=>store.close()); const task=taskFor();store.put(task);
  assert.throws(()=>store.mutate(task.taskId,task.owner,x=>{x.counters.providerCalls=999;throw Error('FAIL');}));
  assert.equal(store.get(task.taskId,task.owner).counters.providerCalls,0); assert.equal(store.get(task.taskId,'other'),null);
});
test('approval binds version, nonce, expiry and idempotency', () => {
  const task=makeTask({owner:'owner',text}); renewApproval(task);
  const request={revision:task.revision,specHash:task.specHash,approvalNonce:task.approvalNonce};
  assert.throws(()=>approve(task,{...request,revision:0},'key-123456'),/VERSION/);
  assert.throws(()=>approve(task,request,'key-123456',Date.now()+700000),/EXPIRED/);
  assert.equal(approve(task,request,'key-123456'),true); assert.equal(approve(task,request,'key-123456'),false);
  assert.throws(()=>approve(task,{...request,revision:2},'key-123456'),/IDEMPOTENCY_CONFLICT/);
});
test('clarification cannot silently preserve an old revision',()=>{
  const task=makeTask({owner:'owner',text:'余额'}); renewApproval(task); const n=task.approvalNonce;
  assert.throws(()=>clarify(task,{revision:0,text}),/REVISION/); clarify(task,{revision:1,text}); assert.equal(task.revision,2);assert.notEqual(task.approvalNonce,n);
});
function ticketTask() { const t=taskFor();t.status='RUNNING';t.leaseGeneration=1;t.snapshot=sampleSnapshot('normal');return t; }
test('ticket is single-use, scope-bound and tamper resistant',()=>{
  const g=new Gateway(),task=ticketTask(),service=config.services[0],ticket=g.issue(task,service);
  assert.throws(()=>g.consume(task,ticket,service,'other'),/SCOPE/);
  assert.throws(()=>g.consume(task,ticket,service,'run-worker',Date.now()+70000),/EXPIRED/);
  assert.throws(()=>g.consume(task,ticket.slice(0,-3)+'aaa',service),/SIGNATURE/);
  g.consume(task,ticket,service);assert.throws(()=>g.consume(task,ticket,service),/REPLAY/);assert.equal(task.counters.providerCalls,1);
});
for(const field of ['stopEpoch','policyEpoch','leaseGeneration']) test('ticket fences '+field,()=>{
  const g=new Gateway(),task=ticketTask(),service=config.services[0],token=g.issue(task,service);task[field]++;assert.throws(()=>g.consume(task,token,service),/SCOPE/);
});
