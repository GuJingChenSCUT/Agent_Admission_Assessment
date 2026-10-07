import crypto from 'node:crypto';
import { config } from './config.js';

export const TASK_STATUSES = Object.freeze(['NEEDS_INPUT', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING', 'STOP_REQUESTED', 'SUCCEEDED', 'FAILED', 'QUARANTINED', 'CANCELLED']);
export const CHECK_STATUSES = Object.freeze(['PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR', 'NOT_CHECKED']);
export const TERMINAL_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED', 'QUARANTINED', 'CANCELLED']);

const UNSUPPORTED_RE = /(erc[-\s]?20|usdt|usdc|transfer|转账|发送交易|solana|polygon|bitcoin|bnb|bot\s*chain|其他链)/i;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function hashCanonical(value) {
  return `0x${crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function parseIntent(text, allowFallback = true) {
  const input = String(text || '').trim();
  const addresses = [...new Set((input.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) || []).map(v => v.toLowerCase()))];
  if (!input) return draft({ intentType: 'UNCLEAR', clarification: '请输入要核验的 Ethereum 原生 ETH 余额任务。', missingFields: ['scope'], allowFallback });
  if (UNSUPPORTED_RE.test(input)) return draft({ intentType: 'UNSUPPORTED', clarification: '当前 P0 只支持 Ethereum 主网原生 ETH 余额只读核验。', missingFields: ['scope'], allowFallback });
  if (addresses.length === 0) return draft({ intentType: 'UNCLEAR', clarification: '请补充一个完整的 0x 地址，不要由 Agent 猜测。', missingFields: ['address'], allowFallback });
  if (addresses.length > 1) return draft({ intentType: 'UNCLEAR', clarification: '发现多个地址，请明确本次只核验的一个地址。', missingFields: ['address_selection'], allowFallback });
  return draft({ intentType: 'NATIVE_BALANCE', address: addresses[0], sourceChainId: '1', asset: 'ETH', clarification: null, missingFields: [], allowFallback });
}

function draft(overrides) {
  return { intentType: 'UNCLEAR', address: null, sourceChainId: null, asset: null, missingFields: [], clarification: null, allowFallback: true, ...overrides };
}

export function taskSpecFromDraft(draftValue) {
  if (draftValue.intentType !== 'NATIVE_BALANCE' || !ADDRESS_RE.test(draftValue.address || '')) return null;
  const candidates = draftValue.allowFallback ? ['svc_primary', 'svc_backup'] : ['svc_primary'];
  return Object.freeze({
    version: '1', sourceChainId: '1', operation: 'NATIVE_BALANCE', asset: 'ETH', address: draftValue.address.toLowerCase(),
    snapshotPolicy: { mode: config.policy.snapshotMode }, candidateServiceIds: candidates,
    limits: { maxCandidateChecks: config.policy.maxCandidateChecks, maxProviderCalls: config.policy.maxProviderCalls, maxFallbacks: draftValue.allowFallback ? config.policy.maxFallbacks : 0, maxModelRounds: 4, maxOutputTokensPerRound: 2048 }
  });
}

export function assertTaskSpec(spec) {
  if (!spec || spec.version !== '1' || spec.sourceChainId !== '1' || spec.operation !== 'NATIVE_BALANCE' || spec.asset !== 'ETH') throw new Error('UNSUPPORTED_SCOPE');
  if (!ADDRESS_RE.test(spec.address)) throw new Error('INVALID_ADDRESS');
  if (spec.snapshotPolicy?.mode !== 'FINALIZED_AT_RUN') throw new Error('UNSUPPORTED_SNAPSHOT_MODE');
  if (!Array.isArray(spec.candidateServiceIds) || spec.candidateServiceIds.length < 1 || spec.candidateServiceIds.length > 2) throw new Error('INVALID_CANDIDATES');
  if (spec.candidateServiceIds.some(id => !config.services.some(s => s.id === id))) throw new Error('UNKNOWN_SERVICE');
  return true;
}

export function makeTask({ owner, text, allowFallback = true, mode = config.executionMode, scenario = 'normal' }) {
  const taskId = `tsk_${crypto.randomBytes(8).toString('hex')}`;
  const parsed = parseIntent(text, allowFallback);
  const spec = taskSpecFromDraft(parsed);
  const now = new Date().toISOString();
  return { taskId, owner, revision: 1, status: spec ? 'AWAITING_APPROVAL' : 'NEEDS_INPUT', phase: 'PLAN', mode, scenario, draft: parsed, spec, specHash: spec ? hashCanonical(spec) : null, runId: null, stopEpoch: 0, policyEpoch: 1, createdAt: now, updatedAt: now, approvedAt: null, snapshot: null, attempts: [], acceptedFact: null, report: null, events: [], counters: { checks: 0, providerCalls: 0, fallbacks: 0 }, stopRequestedAt: null, idempotency: {} };
}

export function transition(task, next, phase = task.phase) {
  const allowed = {
    NEEDS_INPUT: ['NEEDS_INPUT', 'AWAITING_APPROVAL', 'CANCELLED'], AWAITING_APPROVAL: ['NEEDS_INPUT', 'QUEUED', 'CANCELLED'],
    QUEUED: ['RUNNING', 'STOP_REQUESTED'], RUNNING: ['SUCCEEDED', 'FAILED', 'QUARANTINED', 'STOP_REQUESTED'],
    STOP_REQUESTED: ['CANCELLED'], SUCCEEDED: ['SUCCEEDED'], FAILED: ['FAILED'], QUARANTINED: ['QUARANTINED'], CANCELLED: ['CANCELLED']
  };
  if (!allowed[task.status]?.includes(next)) throw new Error(`INVALID_STATE_TRANSITION:${task.status}->${next}`);
  task.status = next; task.phase = phase; task.updatedAt = new Date().toISOString();
  return task;
}

export function addEvent(task, type, message, details = {}) {
  const event = { sequence: task.events.length + 1, type, message, details, at: new Date().toISOString() };
  task.events.push(event); task.updatedAt = event.at; return event;
}

export function makeRuleCheck(ruleId, status, required, reasonCode, expected, observed, sourceClass = 'SYSTEM_OBSERVED') {
  if (!CHECK_STATUSES.includes(status)) throw new Error(`INVALID_CHECK_STATUS:${status}`);
  return { checkId: `chk_${crypto.randomBytes(6).toString('hex')}`, ruleId, required, status, reasonCode, expected, observed, sourceClass, evidenceRefs: [], checkedAt: new Date().toISOString() };
}

export function mandatoryChecksPass(checks) { return checks.filter(c => c.required).every(c => c.status === 'PASS'); }
