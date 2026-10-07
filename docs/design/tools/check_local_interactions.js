const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const pack=require('node:path').resolve(__dirname,'..');
const html=fs.readFileSync(pack+'/Interaction_Prototype.html','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const nodes=JSON.parse(fs.readFileSync(pack+'/checks/dom_nodes.json','utf8'));
function harness(){
 let time=0,next=0;const jobs=new Map(),map=new Map();
 class Element{
  constructor(tag='div',attrs={},value='',text=''){this.tagName=tag;this.attrs={...attrs};this.value=value;this.textContent=text;this.children=[];
   this.checked='checked' in attrs;this.disabled='disabled' in attrs;this.hidden='hidden' in attrs;this.listeners={};this.style={};this.className=attrs.class||'';this.id=attrs.id||'';
   this.dataset={};for(const [k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  emit(type,fields={}){for(const f of this.listeners[type]||[])f({preventDefault(){},...fields})}
  click(){if(!this.disabled)this.emit('click')}
  focus(){document.activeElement=this}
 }
 for(const n of nodes)map.set(n.attrs.id,new Element(n.tag,n.attrs,n.value,n.text));
 const document={activeElement:null,getElementById(id){assert(map.has(id),'Actual HTML contains '+id);return map.get(id)},
  createElement(tag){return new Element(tag)},querySelectorAll(q){
   return [...map.values()].filter(e=>q==='[data-tab]'?e.attrs['data-tab']!==undefined:q==='[data-goto]'?e.attrs['data-goto']!==undefined:q==='[role="tab"]'?e.attrs.role==='tab':false);
  }};
 const sandbox={document,TextEncoder,console,setTimeout(fn,ms=0){const id=++next;jobs.set(id,{fn,due:time+ms});return id},clearTimeout(id){jobs.delete(id)},
  fetch(){throw new Error('Offline prototype attempted network')}};
 sandbox.window=sandbox;sandbox.globalThis=sandbox;const ctx=vm.createContext(sandbox);
 for(const script of scripts)vm.runInContext(script,ctx);
 const state=()=>JSON.parse(JSON.stringify(ctx.DesignApp.getState()));
 const get=id=>map.get(id);
 function step(){if(!jobs.size)return false;const [id,j]=[...jobs.entries()].sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];jobs.delete(id);time=j.due;j.fn();return true}
 function until(predicate){for(let i=0;i<150;i++){if(predicate(state()))return;if(!step())break;}throw new Error('Local state predicate not reached')}
 function terminal(){until(s=>['SUCCEEDED','FAILED','QUARANTINED','CANCELLED'].includes(s.status))}
 function start(scenario='normal',fallback=true){get('scenario').value=scenario;get('allow-fallback').checked=fallback;get('prepare').click();get('approve').click();}
 return {ctx,state,get,step,until,terminal,start,document};
}
const results=[],reports=[];
function test(name,fn){try{const h=harness();fn(h);const s=h.state();if(s.report)reports.push(s.report);results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e)})}}
test('normal accepted fact and optional unknown',h=>{h.start();h.terminal();const s=h.state();assert.equal(s.status,'SUCCEEDED');assert.equal(s.callsUsed,1);assert(s.fact);assert(s.attempts[0].checks.filter(c=>c.required).every(c=>c.status==='PASS'));assert.equal(s.attempts[0].checks.find(c=>!c.required).status,'NOT_CHECKED')});
test('stale snapshot rejected and one fallback',h=>{h.start('stale_primary');h.terminal();const s=h.state();assert.equal(s.status,'SUCCEEDED');assert.equal(s.callsUsed,2);assert.equal(s.fallbacksUsed,1);assert.equal(s.fact.serviceId,'svc_backup');assert.equal(s.attempts[0].checks.find(c=>c.ruleId==='balance_match').status,'NOT_CHECKED');assert.equal(s.report.snapshot.blockHash,s.fact.blockHash)});
test('all candidates fail and no accepted fact',h=>{h.start('both_fail');h.terminal();const s=h.state();assert.equal(s.status,'FAILED');assert.equal(s.callsUsed,2);assert.equal(s.fallbacksUsed,1);assert.equal(s.fact,null);assert.equal(h.get('accepted-result').hidden,true)});
test('reference conflict avoids provider call',h=>{h.start('reference_conflict');h.terminal();const s=h.state();assert.equal(s.status,'QUARANTINED');assert.equal(s.callsUsed,0);assert.equal(s.snapshot,null);assert.equal(s.fact,null)});
test('manifest changed rejected before invocation',h=>{h.start('manifest_changed');h.terminal();const s=h.state();assert.equal(s.status,'SUCCEEDED');assert.equal(s.attempts[0].status,'REJECTED');assert.equal(s.attempts[0].providerCallConsumed,false);assert.equal(s.callsUsed,1)});
test('optional missing remains NOT_CHECKED',h=>{h.start('optional_missing');h.terminal();const s=h.state();assert.equal(s.status,'SUCCEEDED');const c=s.attempts[0].checks.find(c=>c.ruleId==='remote_deployment_provenance');assert.equal(c.status,'NOT_CHECKED');assert.equal(c.required,false);assert.equal(c.sourceClass,'NOT_AVAILABLE')});
test('fallback disabled obeys approved scope',h=>{h.start('stale_primary',false);h.terminal();const s=h.state();assert.equal(s.status,'FAILED');assert.equal(s.callsUsed,1);assert.equal(s.fallbacksUsed,0);assert.equal(s.fact,null)});
test('address clarification and scope revision',h=>{h.get('intent').value='请核对这个地址的 ETH 余额';h.get('prepare').click();assert.equal(h.state().status,'NEEDS_INPUT');h.get('address-answer').value='0x123';h.get('submit-answer').click();assert.equal(h.get('input-error').hidden,false);h.get('address-answer').value='0x'+'22'.repeat(20);h.get('submit-answer').click();const old=h.state();assert.equal(old.revision,2);h.get('edit-scope').click();assert.equal(h.state().specHash,null);h.get('intent').value='核对 0x'+'33'.repeat(20)+' 的 ETH 余额';h.get('prepare').click();const updated=h.state();assert.equal(updated.revision,3);assert.equal(old.taskId,updated.taskId);assert.notEqual(old.specHash,updated.specHash);assert.equal(updated.callsUsed,0)});
test('duplicate local approval creates one run',h=>{h.get('scenario').value='normal';h.get('prepare').click();h.get('approve').click();h.get('approve').click();h.terminal();assert.equal(h.state().callsUsed,1);assert.equal(h.state().events.filter(e=>e.title==='已批准本次样例范围').length,1)});
test('stop during invocation discards late result',h=>{h.start('stale_primary');h.until(s=>s.phase==='INVOKE');assert.equal(h.get('stop').disabled,false);h.get('stop').click();assert.equal(h.state().status,'STOP_REQUESTED');const epoch=h.state().epoch;h.ctx.DesignApp.stop();assert.equal(h.state().epoch,epoch);h.terminal();while(h.step()){}const s=h.state();assert.equal(s.status,'CANCELLED');assert.equal(s.fact,null);assert.equal(s.callsUsed,1);assert.equal(s.fallbacksUsed,0);assert.equal(s.attempts[0].status,'LATE_DISCARDED');assert.equal(s.publication,null)});
test('stop after success preserves fact',h=>{h.start();h.terminal();const before=h.state().fact;h.ctx.DesignApp.stop();assert.equal(h.state().status,'SUCCEEDED');assert.deepEqual(h.state().fact,before)});
test('unsupported transaction scope makes no call',h=>{h.get('intent').value='向 0x'+'22'.repeat(20)+' 转账 1 ETH';h.get('prepare').click();assert.equal(h.state().spec,null);assert.equal(h.state().callsUsed,0);assert.match(h.state().error,/UNSUPPORTED_SCOPE/)});
test('report tamper detected, old preview blocks publication',h=>{h.start();h.terminal();h.get('verify-hash').click();assert.equal(h.state().integrity,true);h.get('preview-public').click();h.get('ack-public').checked=true;h.get('ack-public').emit('change');h.get('tamper-report').click();h.get('verify-hash').click();assert.equal(h.state().integrity,false);h.get('publish-local').click();assert.equal(h.state().publication,null);assert.equal(h.get('publication-error').hidden,false);h.get('restore-report').click();h.get('verify-hash').click();assert.equal(h.state().integrity,true);h.get('preview-public').click();h.get('ack-public').checked=true;h.get('ack-public').emit('change');h.get('publish-local').click();assert.equal(h.state().publication.status,'QUEUED');assert.equal(h.state().publication.transactionHash,null);assert.equal(h.state().publication.signatureEnvelope,null)});
test('roving tab handler updates focus and selected state',h=>{h.get('tab-workspace').focus();h.get('tab-workspace').emit('keydown',{key:'ArrowRight'});assert.equal(h.document.activeElement.id,'tab-services');assert.equal(h.get('tab-services').getAttribute('aria-selected'),'true');assert.equal(h.get('services').hidden,false);assert.equal(h.get('workspace').hidden,true)});
fs.writeFileSync(pack+'/checks/interaction_logic_checks.json',JSON.stringify({scope:'Actual embedded scripts with deterministic clock and minimal DOM double. Does not test browser rendering or native DOM behavior.',tests:results},null,2)+'\n');
fs.writeFileSync(pack+'/checks/scenario_reports.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,total:results.length,failed:results.filter(r=>r.status==='FAIL')},null,2));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
