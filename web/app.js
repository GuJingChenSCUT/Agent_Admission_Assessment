let session = null, task = null, reportEnvelope = null, tampered = false;
const $ = id => document.getElementById(id);
const terminal = ['SUCCEEDED','FAILED','QUARANTINED','CANCELLED'];
async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (session?.csrfToken) headers['x-csrf-token'] = session.csrfToken;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
  return body;
}
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function clearError() { $('error').hidden = true; }
function pill(value) { $('status').textContent = value || '尚未创建'; }
function renderTask(next) {
  task = next; pill(task.status);
  $('budget').textContent = `候选 ${task.counters?.checks || 0} / 2 · 调用 ${task.counters?.providerCalls || 0} / 2 · 切换 ${task.counters?.fallbacks || 0} / ${task.spec?.limits?.maxFallbacks ?? 1}`;
  $('stop').disabled = !task || !['QUEUED','RUNNING','STOP_REQUESTED'].includes(task.status);
  $('approve').disabled = !task || task.status !== 'AWAITING_APPROVAL';
  $('load-evidence').disabled = !task || !terminal.includes(task.status);
  $('events').replaceChildren(...(task.events || []).map(event => { const li = document.createElement('li'); li.textContent = event.message; const small = document.createElement('small'); small.textContent = `${event.type} · ${event.at}`; li.append(small); return li; }));
  const spec = task.spec;
  $('scope').hidden = !spec || task.status !== 'AWAITING_APPROVAL'; $('clarification').hidden = task.status !== 'NEEDS_INPUT';
  if (task.draft?.clarification) $('question').textContent = task.draft.clarification;
  if (spec) { $('fields').replaceChildren(...Object.entries({链: 'Ethereum mainnet (1)',资产: spec.asset,地址: spec.address,快照: spec.snapshotPolicy.mode,候选: spec.candidateServiceIds.join(', '),摘要: task.specHash,批准随机数: task.approvalNonce || '已消费'}).flatMap(([key,value]) => { const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value;return [dt,dd]; })); }
  if (task.acceptedFact) { $('fact').hidden = false; $('amount').textContent = `${(BigInt(task.acceptedFact.balanceWei) / 1000000000000000000n).toString()}.${(BigInt(task.acceptedFact.balanceWei) % 1000000000000000000n).toString().padStart(18,'0').replace(/0+$/,'')} ETH`; $('fact-meta').textContent = `服务 ${task.acceptedFact.serviceId} · block ${task.acceptedFact.blockNumber} · ${task.acceptedFact.balanceWei} wei`; } else $('fact').hidden = true;
  if (terminal.includes(task.status) && !reportEnvelope) loadEvidence();
}
async function loadEvidence() { try { reportEnvelope = await api(`/v1/tasks/${task.taskId}/evidence`); $('report').textContent = JSON.stringify(reportEnvelope, null, 2); $('verify').disabled = false; $('tamper').disabled = false; $('download').disabled = false; renderChecks(reportEnvelope.report); } catch (e) { error(e.message); } }
function renderChecks(report) { $('checks').replaceChildren(...(report?.attempts || []).flatMap(attempt => attempt.checks.map(check => { const div = document.createElement('div'); div.className = 'rule'; div.textContent = `${attempt.serviceId} · ${check.ruleId} · ${check.status} · ${check.reasonCode}`; return div; }))); }
async function refresh() { if (!task) return; try { renderTask(await api(`/v1/tasks/${task.taskId}`)); } catch (e) { error(e.message); } }
async function poll() { for (let i=0;i<60 && task;i++) { await new Promise(r => setTimeout(r, 250)); await refresh(); if (terminal.includes(task.status)) break; } }
$('create').onclick = async () => { clearError(); reportEnvelope = null; try { renderTask(await api('/v1/tasks', { method:'POST', body: JSON.stringify({ text: $('intent').value, allowFallback: $('fallback').checked, scenario: $('scenario').value }) })); } catch (e) { error(e.message); } };
$('clarify').onclick = async () => { clearError(); try { renderTask(await api(`/v1/tasks/${task.taskId}/clarifications`, { method:'POST', body: JSON.stringify({ revision: task.revision, text: $('answer').value }) })); } catch (e) { error(e.message); } };
$('approve').onclick = async () => { clearError(); try { renderTask(await api(`/v1/tasks/${task.taskId}/approve`, { method:'POST', headers:{'idempotency-key': crypto.randomUUID()}, body: JSON.stringify({ revision: task.revision, specHash: task.specHash, approvalNonce: task.approvalNonce }) })); poll(); } catch (e) { error(e.message); } };
$('stop').onclick = async () => { clearError(); try { renderTask(await api(`/v1/tasks/${task.taskId}/stop`, { method:'POST', body:'{}' })); poll(); } catch (e) { error(e.message); } };
$('load-evidence').onclick = loadEvidence;
$('verify').onclick = async () => { if (!reportEnvelope) return; const checked = await api('/v1/public/evidence/verify', { method:'POST', body: JSON.stringify({ report: reportEnvelope.report, reportHash: reportEnvelope.reportHash }) }); $('integrity').textContent = `内容：${checked.integrity} · schema：${checked.schema}`; };
$('tamper').onclick = async () => { if (!reportEnvelope) return; tampered = true; const copy = structuredClone(reportEnvelope.report); if (copy.acceptedFact) copy.acceptedFact.balanceWei = '1'; const checked = await api('/v1/public/evidence/verify', { method:'POST', body: JSON.stringify({ report: copy, reportHash: reportEnvelope.reportHash }) }); $('integrity').textContent = `篡改副本：${checked.integrity}`; };
$('download').onclick = () => { const blob = new Blob([JSON.stringify(reportEnvelope, null, 2)], { type:'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${reportEnvelope.report.reportId}.json`; link.click(); URL.revokeObjectURL(link.href); };
(async function init() { try { session = await api('/v1/session'); $('banner').textContent = `运行模式：${session.executionMode} · 模型：${session.model} · 内容摘要与链上登记分开核对。`; const deployment = await api('/v1/deployment'); $('deployment').replaceChildren(...Object.entries(deployment).flatMap(([key,value]) => { const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value;return [dt,dd]; })); } catch (e) { error(e.message); } })();
