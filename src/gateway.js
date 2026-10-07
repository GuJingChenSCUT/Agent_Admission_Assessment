import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashCanonical } from './domain.js';
import { fault } from './control.js';

const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
export const argumentsFor = task => [task.spec.address, { blockHash: task.snapshot.blockHash, requireCanonical: true }];
export class Gateway {
  constructor(key = randomBytes(32)) { if (key.length < 32) throw new Error('GATEWAY_KEY_TOO_SHORT'); this.key = key; }
  mac(input) { return createHmac('sha256', this.key).update(input).digest(); }
  issue(task, service, caller = 'run-worker') {
    if (task.status !== 'RUNNING' || task.stopRequestedAt || !task.snapshot) throw fault('DISPATCH_NOT_ALLOWED');
    const claims = { aud: 'admission-gateway', taskId: task.taskId, runId: task.runId, caller, specHash: task.specHash, snapshotHash: hashCanonical(task.snapshot), serviceId: service.id, manifestHash: service.manifestHash, method: 'eth_getBalance', argumentsHash: hashCanonical(argumentsFor(task)), policyHash: task.policyHash, policyEpoch: task.policyEpoch, stopEpoch: task.stopEpoch, leaseGeneration: task.leaseGeneration, expiresAt: Date.now() + 60_000, jti: randomBytes(24).toString('hex') };
    const payload = `${encode({ alg: 'HS256', typ: 'JWS' })}.${encode(claims)}`; task.tickets[claims.jti] = { consumed: false, revoked: false }; return `${payload}.${this.mac(payload).toString('base64url')}`;
  }
  consume(task, token, service, caller = 'run-worker', now = Date.now()) {
    const parts = token.split('.'); if (parts.length !== 3) throw fault('INVALID_TICKET'); const [header, payload, signature] = parts, supplied = Buffer.from(signature, 'base64url'), expected = this.mac(`${header}.${payload}`);
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw fault('INVALID_TICKET_SIGNATURE');
    const h = JSON.parse(Buffer.from(header, 'base64url')), c = JSON.parse(Buffer.from(payload, 'base64url')); if (h.alg !== 'HS256' || h.typ !== 'JWS' || c.aud !== 'admission-gateway') throw fault('INVALID_TICKET_AUDIENCE');
    const bound = { taskId: task.taskId, runId: task.runId, caller, specHash: task.specHash, snapshotHash: hashCanonical(task.snapshot), serviceId: service.id, manifestHash: service.manifestHash, method: 'eth_getBalance', argumentsHash: hashCanonical(argumentsFor(task)), policyHash: task.policyHash, policyEpoch: task.policyEpoch, stopEpoch: task.stopEpoch, leaseGeneration: task.leaseGeneration };
    if (Object.entries(bound).some(([key, value]) => c[key] !== value)) throw fault('TICKET_SCOPE_MISMATCH'); if (c.expiresAt <= now) throw fault('TICKET_EXPIRED'); const record = task.tickets[c.jti];
    if (!record || record.revoked || record.consumed) throw fault('TICKET_REPLAY_OR_REVOKED'); if (task.status !== 'RUNNING' || task.stopRequestedAt) throw fault('DISPATCH_STOPPED'); if (task.counters.providerCalls >= task.spec.limits.maxProviderCalls) throw fault('CALL_BUDGET_EXHAUSTED'); record.consumed = true; task.counters.providerCalls++; return argumentsFor(task);
  }
}
