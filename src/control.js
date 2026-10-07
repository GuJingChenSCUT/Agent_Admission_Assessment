import crypto from 'node:crypto';
import { addEvent, hashCanonical, parseIntent, taskSpecFromDraft, transition, TERMINAL_STATUSES } from './domain.js';
import { validateTaskSpec } from './schema.js';

export const nonce = () => crypto.randomBytes(24).toString('hex');
export function fault(code, status = 409) { return Object.assign(new Error(code), { status }); }
export function renewApproval(task) { task.approvalNonce = nonce(); task.approvalExpiresAt = new Date(Date.now() + 600_000).toISOString(); }
export function approve(task, request, key, now = Date.now()) {
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw fault('INVALID_IDEMPOTENCY_KEY', 400);
  const requestHash = hashCanonical(request), scope = `approve:${key}`, prior = task.idempotency[scope];
  if (prior) { if (prior.requestHash !== requestHash) throw fault('IDEMPOTENCY_CONFLICT'); return false; }
  if (task.status !== 'AWAITING_APPROVAL' || !task.spec) throw fault('TASK_NOT_APPROVABLE');
  if (!validateTaskSpec(task.spec).valid) throw fault('TASK_SPEC_INVALID', 500);
  if (request.revision !== task.revision || request.specHash !== task.specHash || request.approvalNonce !== task.approvalNonce) throw fault('APPROVAL_VERSION_MISMATCH');
  if (Date.parse(task.approvalExpiresAt) <= now) throw fault('APPROVAL_EXPIRED');
  task.idempotency[scope] = { requestHash }; task.approvalNonce = null; task.approvedAt = new Date(now).toISOString(); task.runId = `run_${nonce()}`; task.tickets = {}; task.leaseGeneration = 0;
  transition(task, 'QUEUED', 'PLAN'); addEvent(task, 'TASK_APPROVED', '当前版本的地址、区块策略、候选与预算已批准.'); return true;
}
export function clarify(task, request) {
  if (task.status !== 'NEEDS_INPUT') throw fault('TASK_NOT_WAITING_FOR_CLARIFICATION');
  if (request.revision !== task.revision) throw fault('REVISION_MISMATCH');
  const draft = parseIntent(request.text, task.draft.allowFallback); if (draft.intentType === 'UNSUPPORTED') throw fault('UNSUPPORTED_SCOPE', 422);
  task.revision++; task.draft = draft; task.spec = taskSpecFromDraft(draft); task.specHash = task.spec ? hashCanonical(task.spec) : null; task.status = task.spec ? 'AWAITING_APPROVAL' : 'NEEDS_INPUT'; renewApproval(task); addEvent(task, 'SCOPE_REVISED', '范围版本已更新，原批准信息失效。');
}
export function stop(task) {
  if (TERMINAL_STATUSES.includes(task.status) || task.status === 'STOP_REQUESTED') return false;
  task.stopRequestedAt = new Date().toISOString(); task.stopEpoch++; for (const ticket of Object.values(task.tickets || {})) if (!ticket.consumed) ticket.revoked = true;
  const draft = ['NEEDS_INPUT', 'AWAITING_APPROVAL'].includes(task.status); transition(task, draft ? 'CANCELLED' : 'STOP_REQUESTED', draft ? 'COMPLETE' : 'STOPPING'); addEvent(task, 'STOP_ACKNOWLEDGED', '停止已持久化；已发出的查询可能仍被远端处理。'); return true;
}
