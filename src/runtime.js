import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { addEvent, hashCanonical, makeRuleCheck, mandatoryChecksPass, transition, TERMINAL_STATUSES } from './domain.js';
import { buildPublicReport } from './evidence.js';
import { resolveLiveSnapshot, readProviderBalance } from './reference.js';
import { verifyProviderResponse } from './verifier.js';
import { Gateway } from './gateway.js';

const gateway = new Gateway();
export const SAMPLE_HASH = '0x' + '11'.repeat(32);
export const SAMPLE_BALANCE = '42125000000000000000';
export function sampleSnapshot(scenario) {
  if (scenario === 'reference_conflict') throw new Error('REFERENCE_HASH_CONFLICT');
  return { sourceChainId: '1', blockNumber: '24500000', blockHash: SAMPLE_HASH,
    blockTimestamp: '2026-10-07T09:45:00.000Z', capturedAt: new Date().toISOString(), tag: 'finalized', assurance: 'RPC_CROSS_CHECKED',
    references: ['a', 'b'].map(id => ({ sourceId: 'ref_' + id, operatorId: 'operator_' + id,
      observedBlockHash: SAMPLE_HASH, fetchedAt: new Date().toISOString(), balanceWei: SAMPLE_BALANCE })) };
}
export function sampleResponse(task, serviceId) {
  return { balanceWei: task.scenario === 'both_fail' ? (BigInt(SAMPLE_BALANCE) + 1n).toString() : SAMPLE_BALANCE,
    observation: { kind: 'PROVIDER_DECLARED', address: task.spec.address, sourceChainId: '1', asset: 'ETH',
      blockHash: task.scenario === 'stale_primary' && serviceId === 'svc_primary' ? '0x' + '55'.repeat(32) : task.snapshot.blockHash, method: 'eth_getBalance' } };
}
function complete(task, status, message) {
  transition(task, status, 'COMPLETE'); addEvent(task, 'RUN_FINISHED', message); task.report = buildPublicReport(task);
}
function cancel(task) {
  if (task.status !== 'STOP_REQUESTED') return;
  for (const attempt of task.attempts) if (['RUNNING', 'CHECKING'].includes(attempt.status)) {
    attempt.status = attempt.providerCallConsumed ? 'LATE_DISCARDED' : 'CANCELLED'; attempt.decision = 'QUARANTINE'; attempt.finishedAt = new Date().toISOString();
  }
  task.acceptedFact = null; complete(task, 'CANCELLED', '本系统已停止后续执行；已发出的查询可能已被远端处理。');
}
function admission(task, service) {
  const sample = task.mode === 'SAMPLE', changed = sample && task.scenario === 'manifest_changed' && service.id === 'svc_primary';
  return [
    makeRuleCheck('manifest_pin', changed ? 'FAIL' : 'PASS', true, changed ? 'MANIFEST_CHANGED' : 'CONFIG_MANIFEST_PINNED', service.manifestHash, changed ? '0x' + '55'.repeat(32) : service.manifestHash),
    makeRuleCheck('capability_match', sample ? 'PASS' : 'INCONCLUSIVE', true, sample ? 'SAMPLE_CAPABILITY' : 'CAPABILITY_PROBE_NOT_CONFIGURED', 'eth_getBalance with EIP-1898', sample ? 'synthetic fixture' : null),
    makeRuleCheck('client_dependency_policy', sample ? 'PASS' : 'INCONCLUSIVE', true, sample ? 'SAMPLE_DEPENDENCY_FIXTURE' : 'DEPENDENCY_ADAPTER_NOT_CONFIGURED', 'pinned client lockfile checked by OSV', sample ? 'synthetic fixture; no OSV request made' : null),
    makeRuleCheck('remote_deployment_provenance', 'NOT_CHECKED', false, 'PROVENANCE_NOT_AVAILABLE', 'proved remote deployment', null, 'NOT_AVAILABLE')
  ];
}

// No stale worker object may overwrite stop or a newer generation. Every mutation
// reloads state inside SQLite; no external I/O occurs inside a transaction.
export async function runTask(initial, store, options = {}) {
  const { taskId, owner } = initial;
  const change = fn => store.mutate(taskId, owner, fn), read = () => store.get(taskId, owner);
  const pause = () => delay(options.stepMs ?? (read().mode === 'SAMPLE' ? 160 : 0));
  const started = change(task => {
    if (task.status === 'STOP_REQUESTED') { cancel(task); return false; }
    if (task.status !== 'QUEUED') return false;
    task.leaseGeneration = (task.leaseGeneration || 0) + 1;
    transition(task, 'RUNNING', 'REFERENCE'); addEvent(task, 'RUN_STARTED', '工作器已取得运行代际，授权范围已固定。'); return true;
  });
  if (!started.result) return read();
  const generation = started.task.leaseGeneration;
  function fenced(fn) {
    return change(task => {
      if (task.leaseGeneration !== generation) throw new Error('WORKER_FENCED');
      if (task.status === 'STOP_REQUESTED') { cancel(task); return false; }
      if (TERMINAL_STATUSES.includes(task.status)) return false;
      fn(task); return true;
    }).result;
  }
  try {
    await pause(); if (!fenced(() => {})) return read();
    const before = read(); if (before.mode === 'LIVE') throw new Error('LIVE_MODEL_ADAPTER_NOT_CONFIGURED');
    const snapshot = before.mode === 'SAMPLE' ? sampleSnapshot(before.scenario) : await (options.resolveSnapshot || resolveLiveSnapshot)(before.spec.address);
    if (!fenced(task => { task.snapshot = snapshot; addEvent(task, 'REFERENCE_FIXED', '固定 finalized 区块，后续候选沿用同一 hash。'); })) return read();
    const services = before.spec.candidateServiceIds;
    for (let index = 0; index < services.length; index++) {
      await pause(); if (!fenced(() => {})) return read();
      if (index > 0 && !fenced(task => {
        if (task.counters.fallbacks >= task.spec.limits.maxFallbacks) throw new Error('FALLBACK_BUDGET_EXHAUSTED');
        task.counters.fallbacks++; addEvent(task, 'FALLBACK_SELECTED', '在原授权范围内切换备用，地址与参考区块不变。');
      })) return read();
      const service = config.services.find(item => item.id === services[index]); let attemptId;
      if (!fenced(task => {
        if (task.counters.checks >= task.spec.limits.maxCandidateChecks) throw new Error('CHECK_BUDGET_EXHAUSTED');
        task.counters.checks++; task.phase = 'ADMISSION'; attemptId = 'att_' + crypto.randomBytes(12).toString('hex');
        task.attempts.push({ attemptId, serviceId: service.id, manifestHash: service.manifestHash, status: 'CHECKING', decision: 'QUARANTINE', providerCallConsumed: false, checks: admission(task, service), responseDigest: null, observation: null, startedAt: new Date().toISOString(), finishedAt: null });
        addEvent(task, 'ADMISSION_CHECKED', '已生成分项准入检查；声明与未验证项分别记录。', { serviceId: service.id });
      })) return read();
      if (!mandatoryChecksPass(read().attempts.find(a => a.attemptId === attemptId).checks)) {
        fenced(task => {
          const a = task.attempts.find(a => a.attemptId === attemptId), failed = a.checks.some(c => c.required && c.status === 'FAIL');
          a.status = failed ? 'REJECTED' : 'INCONCLUSIVE'; a.decision = failed ? 'REJECT' : 'QUARANTINE'; a.finishedAt = new Date().toISOString();
        }); continue;
      }
      let parameters;
      if (!fenced(task => {
        const a = task.attempts.find(a => a.attemptId === attemptId), ticket = gateway.issue(task, service);
        parameters = gateway.consume(task, ticket, service); a.providerCallConsumed = true; a.status = 'RUNNING'; a.decision = 'ALLOW'; task.phase = 'INVOKE';
        addEvent(task, 'DISPATCH_COMMITTED', '单次票据已消费，调用预算已扣除。', { serviceId: service.id });
      })) return read();
      await pause(); if (!fenced(() => {})) return read();
      let response;
      try { response = read().mode === 'SAMPLE' ? sampleResponse(read(), service.id) : await (options.readBalance || readProviderBalance)(service, parameters[0], snapshot); }
      catch {
        if (!fenced(task => {
          const a = task.attempts.find(a => a.attemptId === attemptId); a.status = 'INCONCLUSIVE'; a.decision = 'QUARANTINE'; a.finishedAt = new Date().toISOString();
          a.checks.push(makeRuleCheck('response_available', 'INCONCLUSIVE', true, 'PROVIDER_RESPONSE_UNKNOWN', 'complete response', null));
        })) return read(); continue;
      }
      const raw = response.rawBytes ? Buffer.from(response.rawBytes) : Buffer.from(JSON.stringify(response));
      const digest = '0x' + crypto.createHash('sha256').update(raw).digest('hex'), artifactId = store.saveArtifact(taskId, raw, digest);
      if (!fenced(task => {
        task.phase = 'VERIFY'; const a = task.attempts.find(a => a.attemptId === attemptId), verified = verifyProviderResponse({ task, snapshot, service, response });
        a.checks.push(...verified.checks); for (const check of verified.checks) check.evidenceRefs = [artifactId]; a.responseDigest = digest;
        a.observation = { bindingKind: response.observation.kind || 'REQUEST_BOUND', requestHash: hashCanonical({ method: 'eth_getBalance', params: parameters }), requestedBlockHash: snapshot.blockHash, providerDeclaredBlockHash: response.observation.kind === 'PROVIDER_DECLARED' ? response.observation.blockHash : null, responseDigest: digest, parsedBalanceWei: response.balanceWei };
        a.finishedAt = new Date().toISOString(); a.status = verified.passed ? 'PASSED' : 'FAILED'; a.decision = verified.decision;
        if (mandatoryChecksPass(a.checks)) {
          task.acceptedFact = { sourceChainId: '1', asset: 'ETH', address: task.spec.address, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, balanceWei: response.balanceWei, serviceId: service.id };
          complete(task, 'SUCCEEDED', '必需规则全部通过，仅采用已验收事实。');
        } else addEvent(task, 'RESULT_REJECTED', '结果未通过验收；错误区块不进行跨区块金额比较。');
      })) return read();
      if (read().status === 'SUCCEEDED') return read();
    }
    fenced(task => {
      const unknown = task.attempts.some(a => a.status === 'INCONCLUSIVE' || a.checks.some(c => c.required && ['INCONCLUSIVE', 'ERROR'].includes(c.status)));
      complete(task, unknown ? 'QUARANTINED' : 'FAILED', unknown ? '必需证据未闭合。' : '获准候选均未通过验收。');
    });
  } catch (error) {
    change(task => {
      if (task.leaseGeneration !== generation) return;
      if (task.status === 'STOP_REQUESTED') return cancel(task);
      if (TERMINAL_STATUSES.includes(task.status)) return;
      addEvent(task, 'WORKER_INCONCLUSIVE', '运行未能形成可用事实。', { code: /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : 'UNCLASSIFIED_ERROR' });
      complete(task, 'QUARANTINED', '检查异常，未转换为通过。');
    });
  }
  return read();
}

export function recoverInterrupted(store) {
  for (const task of store.list()) {
    if (!['RUNNING', 'STOP_REQUESTED'].includes(task.status)) continue;
    store.mutate(task.taskId, task.owner, current => {
      current.leaseGeneration = (current.leaseGeneration || 0) + 1;
      if (current.status === 'STOP_REQUESTED') { cancel(current); return; }
      for (const ticket of Object.values(current.tickets || {})) ticket.revoked = true;
      addEvent(current, 'RECOVERY_QUARANTINED', '中断后的调用结果不明；保留预算与原件，不自动重发。');
      complete(current, 'QUARANTINED', '需要新建任务，旧运行不重放。');
    });
  }
}
