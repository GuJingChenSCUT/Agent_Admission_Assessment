import { hashCanonical } from './domain.js';

export function buildPublicReport(task) {
  const report = {
    schemaVersion: '1', reportId: `rpt_${task.taskId}`, executionMode: task.mode,
    taskSpec: task.spec, taskSpecHash: task.specHash, policyHash: task.policyHash || null,
    subjects: task.attempts.map(attempt => ({ serviceId: attempt.serviceId, namespace: 'agent-admission:v1', transport: 'JSON-RPC', serviceOrigin: attempt.serviceOrigin || null, manifestHash: attempt.manifestHash, ethereumIdentity: null, identityStatus: 'NOT_CHECKED' })),
    subjectHash: hashCanonical(task.attempts.map(attempt => ({ serviceId: attempt.serviceId, manifestHash: attempt.manifestHash }))),
    result: task.status, snapshot: task.snapshot, attempts: task.attempts.map(({ rawResponse, ...safe }) => safe), acceptedFact: task.acceptedFact,
    observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    limitations: task.mode === 'SAMPLE' ? ['All addresses, balances, blocks and observations are synthetic SAMPLE data.', 'No live model, RPC, signature or registry verification occurred.', 'Remote deployment provenance is not verified.', 'Development hash uses SHA-256; production requires vetted JCS + Keccak-256.'] : ['Remote deployment provenance is not verified.', 'No public signature or BOT Chain registry confirmation is attached.']
  };
  return { report, hashAlgorithm: 'sha256-dev-only', reportHash: hashCanonical(report) };
}
