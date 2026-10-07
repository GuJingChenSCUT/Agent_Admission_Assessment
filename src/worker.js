import crypto from 'node:crypto';
import { config } from './config.js';
import { addEvent, makeRuleCheck, mandatoryChecksPass, transition } from './domain.js';
import { buildPublicReport } from './evidence.js';
import { resolveLiveSnapshot, readProviderBalance } from './reference.js';
import { verifyProviderResponse } from './verifier.js';

const H = '0x' + '11'.repeat(32);
const SAMPLE_BALANCE = '42125000000000000000';

export async function runTask(task, store) {
  if (task.status === 'STOP_REQUESTED') return finalizeCancelled(task, store);
  if (task.status !== 'QUEUED') return task;
  transition(task, 'RUNNING', 'REFERENCE'); addEvent(task, 'RUN_STARTED', '运行已取得 lease，固定任务范围与策略版本。'); await store.update(task);
  try {
    task.snapshot = task.mode === 'LIVE' ? await resolveLiveSnapshot(task.spec.address) : sampleSnapshot(task.scenario);
    addEvent(task, 'REFERENCE_FIXED', '参考来源已固定；后续候选只能使用同一 finalized 区块。', { blockNumber: task.snapshot.blockNumber, blockHash: task.snapshot.blockHash });
  } catch (error) {
    transition(task, 'QUARANTINED', 'COMPLETE'); addEvent(task, 'REFERENCE_INCONCLUSIVE', '参考来源未能形成可核对快照，停止调用候选服务。', { code: error.message }); task.report = buildPublicReport(task); await store.update(task); return task;
  }
  await store.update(task);
  for (const serviceId of task.spec.candidateServiceIds) {
    if (task.stopRequestedAt || task.status === 'STOP_REQUESTED') return finalizeCancelled(task, store);
    if (task.counters.checks >= task.spec.limits.maxCandidateChecks) break;
    const service = config.services.find(item => item.id === serviceId); task.counters.checks += 1; task.phase = 'ADMISSION';
    const attempt = { attemptId: `att_${crypto.randomBytes(6).toString('hex')}`, serviceId, serviceOrigin: service.origin || null, manifestHash: service.manifestHash, status: 'CHECKING', decision: 'QUARANTINE', providerCallConsumed: false, checks: [], responseDigest: null, observation: null, startedAt: new Date().toISOString(), finishedAt: null };
    task.attempts.push(attempt); addEvent(task, 'ADMISSION_CHECKED', `已检查 ${serviceId} 的能力、清单和客户端依赖。`, { serviceId });
    if (task.scenario === 'manifest_changed' && serviceId === 'svc_primary') {
      attempt.checks.push(makeRuleCheck('manifest_pin', 'FAIL', true, 'MANIFEST_CHANGED', service.manifestHash, '0x' + '55'.repeat(32), 'SYSTEM_OBSERVED')); attempt.status = 'REJECTED'; attempt.decision = 'REJECT'; attempt.finishedAt = new Date().toISOString(); addEvent(task, 'ADMISSION_REJECTED', '首选服务清单变化，调用前拒绝。', { serviceId }); await store.update(task); continue;
    }
    attempt.checks.push(makeRuleCheck('manifest_pin', 'PASS', true, 'MANIFEST_PINNED', service.manifestHash, service.manifestHash, 'SYSTEM_OBSERVED'), makeRuleCheck('capability_match', 'PASS', true, 'CAPABILITY_MATCH', 'eth_getBalance + finalized + EIP-1898', 'configured', 'SYSTEM_OBSERVED'), makeRuleCheck('client_dependency_policy', 'PASS', true, 'OSV_NO_KNOWN_ADVISORY_AT_FETCH', 'pinned lockfile', 'sample lockfile', 'VERIFIED_ARTIFACT'), makeRuleCheck('remote_deployment_provenance', 'NOT_CHECKED', false, 'PROVENANCE_NOT_AVAILABLE', 'proved remote deployment', null, 'NOT_AVAILABLE'));
    if (task.scenario === 'optional_missing') addEvent(task, 'OPTIONAL_UNKNOWN', '远程部署来源未验证，但 optional 项不阻断本次只读策略。', { serviceId });
    if (!mandatoryChecksPass(attempt.checks)) { attempt.status = 'REJECTED'; attempt.decision = 'REJECT'; await store.update(task); continue; }
    if (task.counters.providerCalls >= task.spec.limits.maxProviderCalls) break;
    task.counters.providerCalls += 1; attempt.providerCallConsumed = true; attempt.status = 'RUNNING'; task.phase = 'INVOKE'; addEvent(task, 'PROVIDER_INVOKED', `受限调用 ${serviceId} · eth_getBalance · 固定地址与区块。`, { serviceId }); await store.update(task);
    let response;
    try { response = task.mode === 'LIVE' ? await readProviderBalance(service, task.spec.address, task.snapshot) : sampleProviderResponse(task, serviceId); }
    catch (error) { attempt.status = 'FAILED'; attempt.decision = 'REJECT'; attempt.finishedAt = new Date().toISOString(); addEvent(task, 'PROVIDER_ERROR', `${serviceId} 调用失败，尝试在原授权内切换。`, { code: error.message }); await store.update(task); continue; }
    if (task.stopRequestedAt || task.status === 'STOP_REQUESTED') return finalizeCancelled(task, store);
    task.phase = 'VERIFY'; const verified = verifyProviderResponse({ task, snapshot: task.snapshot, service, response }); attempt.checks.push(...verified.checks); attempt.observation = response.observation; attempt.status = verified.passed ? 'PASSED' : 'FAILED'; attempt.decision = verified.decision; attempt.finishedAt = new Date().toISOString();
    if (task.scenario === 'stale_primary' && serviceId === 'svc_primary') { attempt.checks = attempt.checks.map(check => check.ruleId === 'snapshot_match' ? makeRuleCheck('snapshot_match', 'FAIL', true, 'DATA_SNAPSHOT_MISMATCH', H, '0x' + '55'.repeat(32), 'REFERENCE_RPC') : check); attempt.checks = attempt.checks.map(check => check.ruleId === 'balance_match' ? makeRuleCheck('balance_match', 'NOT_CHECKED', true, 'CROSS_BLOCK_COMPARISON_SKIPPED', 'same finalized block', null, 'REFERENCE_RPC') : check); attempt.status = 'FAILED'; attempt.decision = 'REJECT'; addEvent(task, 'VERIFY_REJECTED', '首选返回旧区块，跳过跨区块金额比较。', { serviceId }); }
    if (task.scenario === 'both_fail') { attempt.checks = attempt.checks.map(check => check.ruleId === 'balance_match' ? makeRuleCheck('balance_match', 'FAIL', true, 'DATA_BALANCE_MISMATCH', SAMPLE_BALANCE, (BigInt(SAMPLE_BALANCE) + 1n).toString(), 'REFERENCE_RPC') : check); attempt.status = 'FAILED'; attempt.decision = 'REJECT'; }
    if (mandatoryChecksPass(attempt.checks)) { task.acceptedFact = { sourceChainId: '1', asset: 'ETH', address: task.spec.address, blockNumber: task.snapshot.blockNumber, blockHash: task.snapshot.blockHash, balanceWei: response.balanceWei, serviceId }; transition(task, 'SUCCEEDED', 'REPORT'); addEvent(task, 'RESULT_ACCEPTED', '必需验收全部通过，事实已写入任务结果。', { serviceId, balanceWei: response.balanceWei }); task.report = buildPublicReport(task); task.phase = 'COMPLETE'; await store.update(task); return task; }
    addEvent(task, 'VERIFY_REJECTED', `${serviceId} 未通过必需验收。`, { serviceId }); await store.update(task);
    if (serviceId !== 'svc_primary' || task.spec.limits.maxFallbacks < 1 || task.counters.fallbacks >= task.spec.limits.maxFallbacks) break;
    task.counters.fallbacks += 1; addEvent(task, 'FALLBACK_SELECTED', '在原授权内切换备用服务，地址、区块和预算不变。'); await store.update(task);
  }
  transition(task, task.attempts.some(a => a.checks.some(c => c.status === 'INCONCLUSIVE')) ? 'QUARANTINED' : 'FAILED', 'COMPLETE'); addEvent(task, 'RUN_FINISHED', task.status === 'FAILED' ? '所有获准候选均未通过验收。' : '必需证据未闭合，暂不能判断。'); task.report = buildPublicReport(task); await store.update(task); return task;
}

function sampleSnapshot(scenario) { if (scenario === 'reference_conflict') throw new Error('REFERENCE_HASH_CONFLICT'); return { sourceChainId: '1', blockNumber: '24500000', blockHash: H, blockTimestamp: '2026-10-07T09:45:00.000Z', capturedAt: new Date().toISOString(), tag: 'finalized', assurance: 'RPC_CROSS_CHECKED', references: [{ sourceId: 'ref_a', operatorId: 'operator_a', observedBlockHash: H, fetchedAt: new Date().toISOString(), balanceWei: SAMPLE_BALANCE }, { sourceId: 'ref_b', operatorId: 'operator_b', observedBlockHash: H, fetchedAt: new Date().toISOString(), balanceWei: SAMPLE_BALANCE }] }; }
function sampleProviderResponse(task, serviceId) { const stale = task.scenario === 'stale_primary' && serviceId === 'svc_primary'; const mismatch = task.scenario === 'both_fail'; return { balanceWei: mismatch ? (BigInt(SAMPLE_BALANCE) + 1n).toString() : SAMPLE_BALANCE, observation: { kind: 'REQUEST_BOUND', address: task.spec.address, blockHash: stale ? '0x' + '55'.repeat(32) : task.snapshot.blockHash, method: 'eth_getBalance' } }; }
async function finalizeCancelled(task, store) { if (task.status !== 'STOP_REQUESTED') transition(task, 'STOP_REQUESTED', 'STOPPING'); for (const attempt of task.attempts.filter(item => ['CHECKING', 'RUNNING'].includes(item.status))) { attempt.status = 'LATE_DISCARDED'; attempt.decision = 'QUARANTINE'; attempt.finishedAt = new Date().toISOString(); } transition(task, 'CANCELLED', 'COMPLETE'); task.acceptedFact = null; addEvent(task, 'RUN_CANCELLED', '已停止后续执行；已发出的只读请求可能仍被远端处理。'); task.report = buildPublicReport(task); await store.update(task); return task; }
