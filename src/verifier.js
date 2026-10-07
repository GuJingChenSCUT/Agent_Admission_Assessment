import { makeRuleCheck } from './domain.js';
export function verifyProviderResponse({ task, snapshot, service, response }) {
  const obs = response?.observation, wei = response?.balanceWei;
  const format = typeof wei === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(wei) && BigInt(wei) < (1n << 256n);
  const scope = obs?.address?.toLowerCase() === task.spec.address.toLowerCase()
    && (obs.sourceChainId === undefined || obs.sourceChainId === '1') && (obs.asset === undefined || obs.asset === 'ETH');
  const block = typeof obs?.blockHash === 'string' && obs.blockHash.toLowerCase() === snapshot.blockHash.toLowerCase();
  const referenceAgrees = snapshot.references?.length === 2 && snapshot.references.every(r => r.balanceWei === snapshot.references[0].balanceWei);
  const checks = [
    makeRuleCheck('response_schema', format ? 'PASS' : 'FAIL', true, format ? 'INTEGER_FORMAT_VALID' : 'INVALID_WEI', 'uint256 decimal string', typeof wei === 'string' ? wei.slice(0,100) : null),
    makeRuleCheck('response_scope', scope ? 'PASS' : 'FAIL', true, scope ? 'SCOPE_MATCH' : 'DATA_SCOPE_MISMATCH', task.spec.address, obs?.address || null),
    makeRuleCheck('snapshot_match', block ? 'PASS' : 'FAIL', true, block ? 'SNAPSHOT_MATCH' : 'DATA_SNAPSHOT_MISMATCH', snapshot.blockHash, obs?.blockHash || null),
    makeRuleCheck('balance_match', !block || !scope || !format ? 'NOT_CHECKED' : !referenceAgrees ? 'INCONCLUSIVE' : wei === snapshot.references[0].balanceWei ? 'PASS' : 'FAIL',
      true, !block ? 'CROSS_BLOCK_COMPARISON_SKIPPED' : !scope || !format ? 'INVALID_RESPONSE_COMPARISON_SKIPPED' : !referenceAgrees ? 'REFERENCE_BALANCE_CONFLICT' : wei === snapshot.references[0].balanceWei ? 'BALANCE_MATCH' : 'DATA_BALANCE_MISMATCH',
      snapshot.references[0]?.balanceWei || null, block && format ? wei : null, 'REFERENCE_RPC')
  ];
  const passed = checks.every(c => c.status === 'PASS');
  return { serviceId: service.id, manifestHash: service.manifestHash, checks, passed, decision: passed ? 'ALLOW' : checks.some(c => c.status === 'FAIL') ? 'REJECT' : 'QUARANTINE' };
}

