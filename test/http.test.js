import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/http-api.js';
import { TaskStore } from '../src/store.js';

test('HTTP: owner, CSRF, approval, report integrity, artifact privacy and fail-closed publication',async t=>{
  const app=createApplication({store:new TaskStore(':memory:'),mode:'SAMPLE',stepMs:1});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.store.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  async function client(){const response=await fetch(base+'/v1/session');const session=await response.json();const cookie=response.headers.get('set-cookie').split(';')[0];return async(path,method='GET',body,extra={})=>{const r=await fetch(base+path,{method,headers:{cookie,'content-type':'application/json','x-csrf-token':session.csrfToken,...extra},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};};}
  const a=await client(), b=await client();
  assert.equal((await a('/v1/tasks','POST',{text:'hello'},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await a('/v1/tasks','POST',{text:'hello',owner:'attacker'})).status,400);
  const created=await a('/v1/tasks','POST',{text:'ETH 余额 0x2222222222222222222222222222222222222222',scenario:'stale_primary'});assert.equal(created.status,201);
  const task=created.body,path='/v1/tasks/'+task.taskId;
  assert.equal((await b(path)).status,404);assert.equal((await b(path+'/stop','POST',{})).status,404);
  const request={revision:task.revision,specHash:task.specHash,approvalNonce:task.approvalNonce};
  assert.equal((await a(path+'/approve','POST',request)).status,400);
  const key={'idempotency-key':'http-test-key'};
  const approved=await a(path+'/approve','POST',request,key);assert.equal(approved.status,202);assert.equal('tickets'in approved.body,false);
  assert.equal((await a(path+'/approve','POST',request,key)).body.runId,approved.body.runId);
  assert.equal((await a(path+'/approve','POST',{...request,revision:99},key)).status,409);
  let current;
  for(let i=0;i<100;i++){current=(await a(path)).body;if(['SUCCEEDED','QUARANTINED','FAILED'].includes(current.status))break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(current.status,'SUCCEEDED',JSON.stringify(current.events));
  const envelope=(await a(path+'/evidence')).body;
  const check=await a('/v1/public/evidence/verify','POST',{report:envelope.report,reportHash:envelope.reportHash});assert.equal(check.body.integrity,'PASS');assert.equal(check.body.signature,'NOT_CHECKED');
  const copy=structuredClone(envelope.report);copy.acceptedFact.balanceWei='1';assert.equal((await a('/v1/public/evidence/verify','POST',{report:copy,reportHash:envelope.reportHash})).body.integrity,'FAIL');
  const id=current.attempts[0].checks.find(c=>c.evidenceRefs.length).evidenceRefs[0];assert.equal((await a(path+'/artifacts/'+id)).status,200);assert.equal((await b(path+'/artifacts/'+id)).status,404);
  assert.equal((await a('/v1/evidence/'+envelope.report.reportId+'/publications','POST',{})).status,503);
  assert.equal((await a(path+'/events?after=999')).body.events.length,0);
});

test('HTTP: LIVE mode fails closed instead of using SAMPLE fixtures', async t => {
  const app = createApplication({ store: new TaskStore(':memory:'), mode: 'LIVE' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/v1/session`);
  const session = await response.json(); const cookie = response.headers.get('set-cookie').split(';')[0];
  const task = await fetch(`http://127.0.0.1:${app.server.address().port}/v1/tasks`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ text: '核对 0x2222222222222222222222222222222222222222 的 ETH 余额' }) });
  assert.equal(task.status, 503); assert.equal((await task.json()).error, 'LIVE_MODEL_ADAPTER_NOT_CONFIGURED');
});
