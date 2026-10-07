import { makeRuleCheck, mandatoryChecksPass } from './domain.js';

export function verifyProviderResponse({ task, snapshot, service, response }) {
  const checks = [
    makeRuleCheck('response_schema', response && typeof response.balanceWei === 'string' ? 'PASS' : 'FAIL', true, response ? 'RESPONSE_SCHEMA_VALID' : 'RESPONSE_SCHEMA_INVALID', 'decimal wei string', response?.balanceWei ?? null),
    makeRuleCheck('response_scope', response?.observation?.address?.toLowerCase() === task.spec.address.toLowerCase() ? 'PASS' : 'FAIL', true, response?.observation?.address ? 'REQUEST_SCOPE_MATCH' : 'REQUEST_SCOPE_MISSING', task.spec.address, response?.observation?.address ?? null),
    makeRuleCheck('snapshot_match', response?.observation?.blockHash?.toLowerCase() === snapshot.blockHash.toLowerCase() ? 'PASS' : 'FAIL', true, response?.observation?.blockHash ? 'SNAPSHOT_MATCH' : 'SNAPSHOT_MISMATCH', snapshot.blockHash, response?.observation?.blockHash ?? null),
    makeRuleCheck('balance_match', response?.balanceWei === snapshot.references[0].balanceWei ? 'PASS' : 'FAIL', true, response?.balanceWei === snapshot.references[0].balanceWei ? 'BALANCE_MATCH' : 'DATA_BALANCE_MISMATCH', snapshot.references[0].balanceWei, response?.balanceWei ?? null),
    makeRuleCheck('remote_deployment_provenance', 'NOT_CHECKED', false, 'PROVENANCE_NOT_AVAILABLE', 'proved remote deployment', null, 'NOT_AVAILABLE')
  ];
  return { serviceId: service.id, manifestHash: service.manifestHash, checks, passed: mandatoryChecksPass(checks), decision: mandatoryChecksPass(checks) ? 'ALLOW' : 'REJECT' };
}
