(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const copy = v => JSON.parse(JSON.stringify(v));
  const {hashObject} = DesignCrypto;
  const SAMPLE_POLICY = /* POLICY_INLINE */;
  const H = '0x' + '11'.repeat(32), ADDRESS = '0x' + '22'.repeat(20);
  const statusLabels = {NEEDS_INPUT:'等待补答',AWAITING_APPROVAL:'等待批准',QUEUED:'等待开始',RUNNING:'运行中',
    STOP_REQUESTED:'正在收尾',SUCCEEDED:'样例验收通过',FAILED:'验收失败',QUARANTINED:'暂不能判断',CANCELLED:'已停止'};
  const phaseLabels = {PLAN:'等待批准范围',REFERENCE:'固定参考区块',ADMISSION:'检查服务准入',INVOKE:'调用受限服务',
    VERIFY:'验收结果',REPORT:'生成构造报告',STOPPING:'停止请求已本地确认',COMPLETE:'本地模拟已结束'};
  const ruleLabels = {manifest_pin:'服务清单固定',capability_match:'只读方法与区块能力',client_dependency_policy:'客户端依赖公告',
    remote_deployment_provenance:'远程部署来源',response_schema:'响应结构',response_scope:'链、地址与资产范围',
    snapshot_match:'本次参考区块',balance_match:'同区块余额对照'};
  let count = 0, toastTimer;
  const timers = new Set();
  let s;
  function blank() {
    return {taskId:null,revision:0,status:null,phase:'PLAN',spec:null,specHash:null,runId:null,epoch:0,
      scenario:null,snapshot:null,attempts:[],fact:null,checksUsed:0,callsUsed:0,fallbacksUsed:0,events:[],
      note:'',error:'',report:null,originalReport:null,originalHash:null,integrity:null,previewHash:null,
      publication:null,editing:false};
  }
  function toast(text) {
    $('toast').textContent=text; $('toast').hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('toast').hidden=true;},3300);
  }
  function clearTimers() { for (const timer of timers) clearTimeout(timer); timers.clear(); }
  function schedule(fn, ms=380) {
    const epoch=s.epoch, taskId=s.taskId;
    const timer=setTimeout(()=>{
      timers.delete(timer);
      if (s.epoch!==epoch || s.taskId!==taskId || ['CANCELLED','STOP_REQUESTED'].includes(s.status)) return;
      fn();
    },ms);
    timers.add(timer);
  }
  function log(title, detail, color='green', code='TASK_UPDATED') {
    s.events.push({sequence:s.events.length+1,title,detail,color,code}); renderRuntime();
  }
  function setStatus(status,phase=s.phase) { s.status=status;s.phase=phase;render(); }
  function switchTab(tab) {
    for(const id of ['workspace','services','evidence','deployment']) {
      $(id).hidden = id!==tab;
      $('tab-'+id).setAttribute('aria-selected',String(id===tab));
      $('tab-'+id).tabIndex = id===tab ? 0 : -1;
    }
  }
  function unsupported(text) { return /(erc[-\s]?20|usdt|usdc|转账|发送交易|transfer|solana|polygon|bitcoin|bnb|bot\s*chain|其他链)/i.test(text); }
  function prepare() {
    if(['QUEUED','RUNNING','STOP_REQUESTED'].includes(s.status)) return;
    const previous=s.editing?{taskId:s.taskId,revision:s.revision,events:s.events}:null;
    clearTimers();s=blank();
    if(previous) Object.assign(s,previous);
    else {s.taskId='tsk_sample'+String(++count).padStart(4,'0');s.revision=1;}
    $('ack-public').checked=false; $('address-answer').value='';
    const text=$('intent').value.trim();
    if(!text) { s.error='请输入要核验的原生 ETH 余额任务。';render();return; }
    if(unsupported(text)) {s.error='UNSUPPORTED_SCOPE：此原型只支持 Ethereum 原生 ETH 余额只读核验。';render();return;}
    const matches=text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)||[];
    const addresses=[...new Set(matches.map(a=>a.toLowerCase()))];
    if(addresses.length!==1){
      s.status='NEEDS_INPUT';s.note=addresses.length>1?'发现多个地址，请明确本次核验地址。':'缺少地址，请补充一个完整地址。';
      log('需要补充地址',s.note,'amber');render();$('address-answer').focus();return;
    }
    defineSpec(addresses[0]);
  }
  function defineSpec(address) {
    s.spec={version:'1',sourceChainId:'1',operation:'NATIVE_BALANCE',asset:'ETH',address,
      snapshotPolicy:{mode:'FINALIZED_AT_RUN'},candidateServiceIds: $('allow-fallback').checked?['svc_primary','svc_backup']:['svc_primary'],
      limits:{maxCandidateChecks:2,maxProviderCalls:2,maxFallbacks:$('allow-fallback').checked?1:0,maxModelRounds:4,maxOutputTokensPerRound:2048}};
    s.specHash=hashObject(s.spec);s.status='AWAITING_APPROVAL';s.phase='PLAN';s.error='';s.note='';
    log('范围已生成','本地规则提案；尚未调用服务。');render();
  }
  function clarify() {
    if(s.status!=='NEEDS_INPUT') return;
    const address=$('address-answer').value.trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(address)) {s.error='地址需为 0x 开头、随后 40 位十六进制。';render();return;}
    s.revision++;s.error='';defineSpec(address.toLowerCase());
  }
  function editScope() {
    if(s.status!=='AWAITING_APPROVAL')return;
    s.spec=null;s.specHash=null;s.revision++;s.status='NEEDS_INPUT';s.editing=true;
    s.note='请修改输入并重新生成范围；原版本批准已失效。';
    log('修改范围','revision 已增加，旧摘要不能继续批准。','amber');render();$('intent').focus();
  }
  function makeSnapshot() {
    return {sourceChainId:'1',blockNumber:'24500000',blockHash:H,blockTimestamp:'2026-10-07T09:45:00Z',
      capturedAt:'2026-10-07T10:00:00Z',tag:'finalized',assurance:'RPC_CROSS_CHECKED',references:['a','b'].map(a=>({
        sourceId:'ref_'+a,operatorId:'operator_'+a,observedBlockHash:H,fetchedAt:'2026-10-07T10:00:00Z',balanceWei:'42125000000000000000'}))};
  }
  function approve() {
    if(s.status!=='AWAITING_APPROVAL') return;
    s.runId='run_sample'+String(count).padStart(4,'0');s.scenario=$('scenario').value;
    setStatus('QUEUED','PLAN');log('已批准本次样例范围','固定 revision、TaskSpec 与预算；未调用真实后端。');
    schedule(()=>{
      setStatus('RUNNING','REFERENCE');log('核对参考来源','构造的两份 finalized 观测。');
      schedule(()=>{
        if(s.scenario==='reference_conflict') {
          log('参考区块不一致','INCONCLUSIVE：不判断哪个服务恶意，也不继续调用。','amber');
          finish('QUARANTINED','参考来源冲突，当前不能形成可用余额。');return;
        }
        s.snapshot=makeSnapshot();log('参考区块已固定','样例高度 24500000；后续所有候选使用同一 hash。');
        inspect('svc_primary');
      });
    },200);
  }
  function check(ruleId,status='PASS',required=true,reasonCode='SAMPLE_MATCH',expected='本次样例策略',observed='符合样例策略',sourceClass='SYSTEM_OBSERVED') {
    return {checkId:'chk_sample_'+s.attempts.length+'_'+ruleId,ruleId,required,status,reasonCode,expected,observed,
      sourceClass,evidenceRefs:status==='NOT_CHECKED'?[]:['ev_sample_'+ruleId],checkedAt:'2026-10-07T10:00:00Z'};
  }
  function inspect(serviceId) {
    if(s.checksUsed>=s.spec.limits.maxCandidateChecks) {finish('FAILED','候选检查预算已用尽。');return;}
    s.checksUsed++;s.phase='ADMISSION';
    const attempt={attemptId:'att_sample'+count+'_'+(s.attempts.length+1),serviceId,manifestHash:'0x'+'44'.repeat(32),
      status:'CHECKING',decision:'QUARANTINE',providerCallConsumed:false,checks:[],responseDigest:null,observation:null,
      startedAt:'2026-10-07T10:00:00Z',finishedAt:null};
    s.attempts.push(attempt);
    log('检查'+(serviceId==='svc_primary'?'首选':'备用')+'服务','受限方法、清单版本和客户端依赖。');render();
    schedule(()=>{
      attempt.checks=[check('manifest_pin'),check('capability_match'),check('client_dependency_policy','PASS',true,
        'SAMPLE_ADVISORY_RESULT','固定客户端锁文件','构造的“未检索到公告”结果，未查询 OSV','VERIFIED_ARTIFACT'),
        check('remote_deployment_provenance','NOT_CHECKED',false,'PROVENANCE_NOT_VERIFIED','远程部署证明',
          s.scenario==='optional_missing'?null:'服务方声明不等于证明',s.scenario==='optional_missing'?'NOT_AVAILABLE':'PROVIDER_DECLARED')];
      if(serviceId==='svc_primary' && s.scenario==='manifest_changed') {
        attempt.checks[0]=check('manifest_pin','FAIL',true,'MANIFEST_CHANGED','固定版本摘要','构造的变更摘要');
        attempt.status='REJECTED';attempt.decision='REJECT';attempt.finishedAt='2026-10-07T10:00:01Z';
        log('首选清单发生变化','在调用前拒绝，未消费首选服务调用次数。','red');render();fallbackOrFail();return;
      }
      attempt.decision='ALLOW';
      if(s.scenario==='optional_missing') log('远程来源未验证','optional 项不阻断当前只读策略，但不显示为已通过。','amber');
      schedule(()=>invoke(attempt),220);
    });
  }
  function invoke(attempt) {
    if(s.callsUsed>=s.spec.limits.maxProviderCalls) {finish('FAILED','服务调用预算已用尽。');return;}
    s.callsUsed++;attempt.status='RUNNING';attempt.providerCallConsumed=true;s.phase='INVOKE';
    log('模拟受限调用',attempt.serviceId+' · eth_getBalance · 固定地址与区块。');render();
    schedule(()=>{
      s.phase='VERIFY';log('验收返回内容','先核对范围与区块，再比较同区块余额。');render();
      schedule(()=>verifyAttempt(attempt));
    },550);
  }
  function verifyAttempt(attempt) {
    const stale=s.scenario==='stale_primary' && attempt.serviceId==='svc_primary';
    const wrong=s.scenario==='both_fail';
    attempt.checks.push(check('response_schema'),check('response_scope'));
    if(stale) {
      attempt.checks.push(check('snapshot_match','FAIL',true,'DATA_SNAPSHOT_MISMATCH',H,'0x'+'55'.repeat(32),'REFERENCE_RPC'),
        check('balance_match','NOT_CHECKED',true,'CROSS_BLOCK_COMPARISON_SKIPPED','同区块余额',null,'REFERENCE_RPC'));
      attempt.status='FAILED';attempt.decision='REJECT';attempt.finishedAt='2026-10-07T10:00:02Z';
      log('首选返回的区块不符','拒绝本次快照；跳过跨区块余额比较。','red');render();fallbackOrFail();return;
    }
    attempt.checks.push(check('snapshot_match','PASS',true,'SAMPLE_SNAPSHOT_MATCH',H,H,'REFERENCE_RPC'));
    if(wrong) {
      attempt.checks.push(check('balance_match','FAIL',true,'DATA_BALANCE_MISMATCH','42125000000000000000','42126000000000000000','REFERENCE_RPC'));
      attempt.status='FAILED';attempt.decision='REJECT';attempt.finishedAt='2026-10-07T10:00:02Z';
      log('同区块余额验收失败',attempt.serviceId+' 的构造值与参考值不一致。','red');render();fallbackOrFail();return;
    }
    attempt.checks.push(check('balance_match','PASS',true,'SAMPLE_BALANCE_MATCH','42125000000000000000','42125000000000000000','REFERENCE_RPC'));
    if(!attempt.checks.filter(c=>c.required).every(c=>c.status==='PASS')) {finish('QUARANTINED','必需检查未全部通过。');return;}
    attempt.status='PASSED';attempt.decision='ALLOW';attempt.finishedAt='2026-10-07T10:00:02Z';
    s.fact={sourceChainId:'1',asset:'ETH',address:s.spec.address,blockNumber:s.snapshot.blockNumber,blockHash:s.snapshot.blockHash,
      balanceWei:'42125000000000000000',serviceId:attempt.serviceId};
    log('通过本地样例验收','必需检查全通过；远程部署来源仍未验证。');
    finish('SUCCEEDED','');
  }
  function fallbackOrFail() {
    const permitted=s.spec.candidateServiceIds.includes('svc_backup') && s.fallbacksUsed<s.spec.limits.maxFallbacks;
    if(!permitted) {finish('FAILED','未获准继续切换，或全部候选均失败。');return;}
    s.fallbacksUsed++;log('在原授权内切换备用','不更改地址、资产、参考区块或调用上限。','amber');
    schedule(()=>inspect('svc_backup'),240);
  }
  function buildReport() {
    if(!s.spec) return;
    const subjects=s.spec.candidateServiceIds.map(serviceId=>({serviceId,namespace:'agent-admission:sample:v1',
      transport:'MCP',serviceOrigin:'https://'+(serviceId==='svc_primary'?'primary':'backup')+'.example.invalid',
      manifestHash:'0x'+'44'.repeat(32),ethereumIdentity:null,identityStatus:'NOT_CHECKED'}));
    const report={schemaVersion:'1',reportId:'rpt_sample'+String(count).padStart(4,'0'),executionMode:'SAMPLE',
      taskSpec:copy(s.spec),taskSpecHash:s.specHash,policyHash:hashObject(SAMPLE_POLICY),subjects,subjectHash:hashObject(subjects),
      result:s.status,snapshot:copy(s.snapshot),attempts:copy(s.attempts),acceptedFact:copy(s.fact),
      observedAt:'2026-10-07T10:00:02Z',expiresAt:'2026-10-08T10:00:02Z',limitations:[
        'All addresses, balances, blocks and observations are synthetic SAMPLE data.',
        'No live model, RPC, OSV, signature or registry verification occurred.',
        'Remote deployment provenance is not verified.', 'Reference cross-checking is not a cryptographic state proof.', 'These sample MCP services explicitly declare the block; raw eth_getBalance returns no block proof.']};
    s.report=report;s.originalReport=copy(report);s.originalHash=hashObject(report);s.integrity=null;
    s.previewHash=null;s.publication=null;
    $('ack-public').checked=false;$('publication-error').hidden=true;
    $('hash-message').textContent='摘要只证明内容是否相同，不证明余额真实或已上链。';
    $('hash-message').className='callout';$('publication-note').textContent='不会签名、广播或产生交易 hash。';
  }
  function finish(status,note) {s.status=status;s.phase='COMPLETE';s.note=note;buildReport();render();}
  function stop() {
    if(!s.status) return;
    if(['SUCCEEDED','FAILED','QUARANTINED','CANCELLED'].includes(s.status)) {
      toast('任务已是终态；停止不会改写已经提交的事实。');return;
    }
    if(s.status==='STOP_REQUESTED') return;
    clearTimers();s.epoch++;
    if(['NEEDS_INPUT','AWAITING_APPROVAL'].includes(s.status)) {finish('CANCELLED','草稿已取消；没有外部调用。');return;}
    const attempt=s.attempts.findLast(a=>['RUNNING','CHECKING'].includes(a.status));
    const inFlight=attempt && attempt.status==='RUNNING';
    if(attempt) attempt.status='CANCEL_REQUESTED';
    s.status='STOP_REQUESTED';s.phase='STOPPING';
    log('停止已本地确认','不再发起调用或备用切换；已发出的请求可能仍被远端处理。','amber','STOP_ACKNOWLEDGED');render();
    const epoch=s.epoch,taskId=s.taskId;
    const timer=setTimeout(()=>{
      timers.delete(timer);if(s.epoch!==epoch || s.taskId!==taskId) return;
      if(attempt) {attempt.status=inFlight?'LATE_DISCARDED':'CANCELLED';attempt.decision='QUARANTINE';attempt.finishedAt='2026-10-07T10:00:02Z';}
      if(inFlight) log('模拟晚到响应已丢弃','LATE_DISCARDED：不采用金额，不切换，不自动发布。','amber','LATE_RESPONSE_DISCARDED');
      s.fact=null;log('已停止后续执行','本地终态为 CANCELLED；没有链上撤销承诺。','amber');finish('CANCELLED','本地停止完成；已发出的查询可能仍被远端处理。');
    },260);timers.add(timer);
  }
  function pill(text,color='') {const span=document.createElement('span');span.className='pill '+color;span.textContent=text;return span;}
  function pair(dl,key,value,mono=false) {
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;
    if(mono)dd.className='mono';dl.append(dt,dd);
  }
  function renderRuntime() {
    const status=$('task-status');status.textContent=statusLabels[s.status]||'尚未创建';
    status.className='pill '+(s.status==='SUCCEEDED'?'green':['FAILED'].includes(s.status)?'red':['QUARANTINED','STOP_REQUESTED','CANCELLED'].includes(s.status)?'amber':'');
    $('phase-label').textContent=phaseLabels[s.phase];
    $('checks-count').textContent=s.checksUsed+' / 2';$('calls-count').textContent=s.callsUsed+' / 2';
    $('fallback-count').textContent=s.fallbacksUsed+' / '+(s.spec?s.spec.limits.maxFallbacks:1);
    $('stop').disabled=!['QUEUED','RUNNING'].includes(s.status);
    $('stop').textContent=s.status==='STOP_REQUESTED'?'正在结束…':'停止任务';
    const list=$('timeline');list.replaceChildren();
    if(!s.events.length) {const li=document.createElement('li');li.textContent='尚未调用服务；生成并批准范围后开始模拟。';list.append(li);}
    s.events.forEach(event=>{
      const li=document.createElement('li'),dot=document.createElement('div'),content=document.createElement('div');li.className=event.color;
      dot.className='dot';dot.textContent=String(event.sequence);const title=document.createElement('strong'),detail=document.createElement('div');
      title.textContent=event.title;detail.className='detail';detail.textContent=event.detail;content.append(title,detail);li.append(dot,content);list.append(li);
    });
    $('accepted-result').hidden=!(s.status==='SUCCEEDED' && s.fact);
    if(s.fact) $('result-detail').textContent='构造区块 '+s.fact.blockNumber+' · '+s.fact.serviceId+' · '+s.fact.balanceWei+' wei';
    $('run-note').hidden=!s.note;$('run-note').textContent=s.note;
  }
  function renderServices() {
    const cards=$('service-cards');cards.replaceChildren();
    ['svc_primary','svc_backup'].forEach(id=>{
      const card=document.createElement('div');card.className='card';const head=document.createElement('div');head.className='row between';
      const h=document.createElement('h2');h.textContent=id==='svc_primary'?'首选数据服务':'备用数据服务';head.append(h,pill('构造样例'));
      const idText=document.createElement('p');idText.className='mono muted';idText.textContent=id+' · 管理员配置 · HTTP/MCP 接入设计';card.append(head,idText);
      const list=document.createElement('ul');list.className='rule-list';const a=s.attempts.find(a=>a.serviceId===id);
      for(const ruleId of ['manifest_pin','capability_match','client_dependency_policy','remote_deployment_provenance']) {
        const c=a && a.checks.find(c=>c.ruleId===ruleId),li=document.createElement('li'),info=document.createElement('div');
        const title=document.createElement('div');title.textContent=ruleLabels[ruleId];info.append(title);
        const note=document.createElement('div');note.className='rule-note';note.textContent=c?(c.observed||'资料不可用'):'尚未进行本次检查';info.append(note);
        li.append(info,pill(c?({PASS:'样例通过',FAIL:'失败',NOT_CHECKED:'未验证',INCONCLUSIVE:'待核验'}[c.status]||c.status):'未检查',c&&c.status==='PASS'?'green':c&&c.status==='FAIL'?'red':'amber'));list.append(li);
      }
      card.append(list);cards.append(card);
    });
  }
  function renderEvidence() {
    $('evidence-empty').hidden=!!s.report;$('evidence-body').hidden=!s.report;if(!s.report)return;
    $('report-result').textContent=statusLabels[s.report.result];
    const dl=$('evidence-scope');dl.replaceChildren();pair(dl,'执行模式','SAMPLE · 全部构造');pair(dl,'地址',s.report.taskSpec.address,true);
    pair(dl,'数据链','Ethereum 1');pair(dl,'区块',s.report.snapshot?s.report.snapshot.blockNumber+' · finalized':'未形成有效参考快照');
    pair(dl,'余额事实',s.report.acceptedFact?s.report.acceptedFact.balanceWei+' wei':'没有通过验收的余额',true);
    pair(dl,'未覆盖','真实部署来源、密码学状态证明、真实在线链路');
    $('original-hash').textContent=s.originalHash;$('report-json').textContent=JSON.stringify(s.report,null,2);
    $('tamper-report').disabled=!s.report.acceptedFact;
    $('integrity-status').textContent=s.integrity===true?'内容摘要相符':s.integrity===false?'内容摘要不符':'尚未核对';
    $('integrity-status').className='pill '+(s.integrity===true?'green':s.integrity===false?'red':'');
    $('public-preview').hidden=!s.previewHash;$('preview-hash').textContent=s.previewHash||'';
    $('disclosure').textContent='公开：地址 '+s.report.taskSpec.address+'、任务范围、区块、服务命名空间/origin/清单摘要/身份状态、验收检查和局限。此处仅预览本地样例。';
    $('publish-local').disabled=!s.previewHash||!$('ack-public').checked||!!s.publication;
    const parent=$('evidence-checks');parent.replaceChildren();
    if(!s.report.attempts.length) {const note=document.createElement('p');note.className='muted';note.textContent='未调用候选服务；参考未闭合或任务已在调用前停止。';parent.append(note);}
    s.report.attempts.forEach(a=>{
      const h=document.createElement('h3');h.textContent=a.serviceId+' · '+a.status;parent.append(h);
      const list=document.createElement('ul');list.className='rule-list';
      a.checks.forEach(c=>{const li=document.createElement('li'),info=document.createElement('div');
        info.textContent=(ruleLabels[c.ruleId]||c.ruleId)+(c.required?' · 必需':' · 可选');
        const note=document.createElement('div');note.className='rule-note';note.textContent=c.reasonCode;info.append(note);
        li.append(info,pill(c.status,c.status==='PASS'?'green':c.status==='FAIL'?'red':'amber'));list.append(li);});parent.append(list);
    });
  }
  function render() {
    const active=['QUEUED','RUNNING','STOP_REQUESTED'].includes(s.status);
    $('prepare').disabled=active||s.status==='AWAITING_APPROVAL';
    $('intent').disabled=active||s.status==='AWAITING_APPROVAL';$('allow-fallback').disabled=active||s.status==='AWAITING_APPROVAL';
    $('scenario').disabled=active;$('clarification').hidden=s.status!=='NEEDS_INPUT'||s.editing;
    $('input-error').hidden=!s.error;$('input-error').textContent=s.error;
    $('scope-card').hidden=!s.spec;$('approve').disabled=s.status!=='AWAITING_APPROVAL';
    $('cancel-draft').disabled=s.status!=='AWAITING_APPROVAL';$('edit-scope').disabled=s.status!=='AWAITING_APPROVAL';$('revision').textContent='REV '+s.revision;
    const dl=$('scope-fields');dl.replaceChildren();
    if(s.spec){pair(dl,'任务',s.taskId,true);pair(dl,'数据链','Ethereum mainnet · 1');pair(dl,'地址',s.spec.address,true);
      pair(dl,'资产与方法','原生 ETH · eth_getBalance');pair(dl,'快照','执行时固定 finalized 区块');
      pair(dl,'候选',s.spec.candidateServiceIds.join(' → '),true);pair(dl,'限额','最多 2 次调用、'+s.spec.limits.maxFallbacks+' 次切换');pair(dl,'TaskSpecHash',s.specHash,true);}
    renderRuntime();renderServices();renderEvidence();
  }
  function verifyHash() {
    if(!s.report)return;s.integrity=hashObject(s.report)===s.originalHash;
    $('hash-message').textContent=s.integrity?'本地内容摘要相符。签名、真实数据与主网记录仍未验证。':'内容摘要不符：当前对象已偏离原报告，不能用旧摘要批准公开。';
    $('hash-message').className='callout '+(s.integrity?'':'error');renderEvidence();
  }
  function tamper() {
    if(!s.report || !s.report.acceptedFact)return;
    s.report.acceptedFact.balanceWei='42126000000000000000';s.integrity=null;
    $('hash-message').textContent='已把样例金额改动。基准摘要保持原值，请核对。';renderEvidence();
  }
  function restore() {
    if(!s.originalReport)return;s.report=copy(s.originalReport);s.integrity=null;
    $('hash-message').textContent='已恢复原始构造报告，仍需分别核对其他层。';$('publication-error').hidden=true;renderEvidence();
  }
  function preview() {
    if(!s.report)return;
    if(hashObject(s.report)!==s.originalHash){$('publication-error').hidden=false;$('publication-error').textContent='HASH_MISMATCH：当前内容已变化，先恢复原件。';return;}
    s.previewHash=s.originalHash;$('ack-public').checked=false;$('publication-error').hidden=true;renderEvidence();
  }
  function publish() {
    if(!s.previewHash || !$('ack-public').checked || s.publication)return;
    if(hashObject(s.report)!==s.previewHash || s.previewHash!==s.originalHash) {
      $('publication-error').hidden=false;$('publication-error').textContent='HASH_MISMATCH：预览后内容变化，未创建登记队列。';return;
    }
    s.publication={status:'QUEUED',executionMode:'SAMPLE',reportHash:s.previewHash,transactionHash:null,signatureEnvelope:null,anchorReceipt:null,currentAnchor:null};
    $('publication-note').textContent='SAMPLE / QUEUED：仅已加入本地示例队列。未签名、未广播、未上链；任务停止不代表删除公共记录。';
    $('publication-error').hidden=true;renderEvidence();
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.goto)));
  const tabs=[...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((b,i)=>b.addEventListener('keydown',e=>{
    let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;
    else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;
    e.preventDefault();switchTab(tabs[n].dataset.tab);tabs[n].focus();
  }));
  $('prepare').addEventListener('click',prepare);$('submit-answer').addEventListener('click',clarify);
  $('approve').addEventListener('click',approve);$('edit-scope').addEventListener('click',editScope);$('cancel-draft').addEventListener('click',stop);$('stop').addEventListener('click',stop);
  $('view-evidence').addEventListener('click',()=>switchTab('evidence'));$('verify-hash').addEventListener('click',verifyHash);
  $('tamper-report').addEventListener('click',tamper);$('restore-report').addEventListener('click',restore);
  $('preview-public').addEventListener('click',preview);$('ack-public').addEventListener('change',renderEvidence);
  $('publish-local').addEventListener('click',publish);
  s=blank();render();switchTab('workspace');
  // Inspection API for design checks only; this page cannot authorize a real task.
  window.DesignApp=Object.freeze({getState:()=>copy(s),stop,canonicalize:DesignCrypto.canonicalize,hashObject:DesignCrypto.hashObject});
})();
