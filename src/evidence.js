import { hashCanonical } from './domain.js';
import { config } from './config.js';
import { validateDefinition } from './schema.js';
export function buildPublicReport(task) {
  if (!task.spec) return null;
  const subjects = task.spec.candidateServiceIds.map(id => {
    const svc = config.services.find(s => s.id === id);
    return { serviceId: id, namespace: task.mode === 'SAMPLE' ? 'agent-admission:sample:v1' : 'agent-admission:v1',
      transport: 'HTTP_RPC', serviceOrigin: task.mode === 'SAMPLE' ? 'https://' + id + '.example.invalid' : null,
      manifestHash: svc.manifestHash, ethereumIdentity: null, identityStatus: 'NOT_CHECKED' };
  });
  const report = {
    schemaVersion: '1', reportId: 'rpt_' + task.taskId, executionMode: task.mode,
    taskSpec: structuredClone(task.spec), taskSpecHash: task.specHash, policyHash: task.policyHash,
    subjects, subjectHash: hashCanonical(subjects), result: task.status, snapshot: structuredClone(task.snapshot),
    attempts: structuredClone(task.attempts), acceptedFact: structuredClone(task.acceptedFact),
    observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    limitations: [
      ...(task.mode === 'SAMPLE' ? ['Synthetic SAMPLE data: no model, RPC, OSV, wallet or mainnet call occurred.'] : ['Live integration is incomplete.']),
      'Remote deployment provenance and Ethereum identity are not verified.',
      'RPC cross-checking is not a cryptographic state proof.',
      'A content hash proves equality, not truth; no signature or registry confirmation is attached.',
      'REQUEST_BOUND observations cannot prove which block a remote backend actually used.'
    ]
  };
  const valid = validateDefinition('PublicReport', report);
  if (!valid.valid) throw new Error('PUBLIC_REPORT_SCHEMA_INVALID');
  return { report, reportHash: hashCanonical(report), hashAlgorithm: 'keccak256-jcs-rfc8785' };
}

