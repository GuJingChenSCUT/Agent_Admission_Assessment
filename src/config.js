import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const intEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = Object.freeze({
  port: intEnv('AA_PORT', 8787),
  dataDir: path.resolve(process.env.AA_DATA_DIR || '.data'),
  executionMode: (process.env.AA_EXECUTION_MODE || 'SAMPLE').toUpperCase(),
  maxBodyBytes: intEnv('AA_MAX_BODY_BYTES', 1024 * 1024),
  references: Object.freeze([
    { sourceId: 'ref_a', operatorId: 'operator_a', url: process.env.AA_REFERENCE_RPC_A || '' },
    { sourceId: 'ref_b', operatorId: 'operator_b', url: process.env.AA_REFERENCE_RPC_B || '' }
  ]),
  services: Object.freeze([
    { id: 'svc_primary', origin: process.env.AA_PRIMARY_RPC || '', manifestHash: '0x' + '44'.repeat(32) },
    { id: 'svc_backup', origin: process.env.AA_BACKUP_RPC || '', manifestHash: '0x' + '45'.repeat(32) }
  ]),
  policy: Object.freeze({
    sourceChainId: '1', operation: 'NATIVE_BALANCE', asset: 'ETH', snapshotMode: 'FINALIZED_AT_RUN',
    maxCandidateChecks: 2, maxProviderCalls: 2, maxFallbacks: 1,
    maxReferenceRpcCalls: 12, maxProviderResponseBytes: 1024 * 1024,
    eip1898Required: true, registryChainId: '677'
  })
});

export async function ensureDataDir() {
  await fs.promises.mkdir(config.dataDir, { recursive: true });
}
