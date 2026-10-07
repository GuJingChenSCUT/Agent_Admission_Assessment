import crypto from 'node:crypto';
import { config } from './config.js';

const hex = value => String(value).toLowerCase();
const jsonRpc = async (url, method, params, timeoutMs = 12_000) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomInt(1, 2 ** 31), method, params }), signal: controller.signal }); if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`); const body = await response.json(); if (body.error) throw new Error(`RPC_${body.error.code || 'ERROR'}:${body.error.message || 'unknown'}`); return body.result; }
  finally { clearTimeout(timer); }
};

export async function resolveLiveSnapshot(address) {
  if (config.references.some(ref => !ref.url)) throw new Error('REFERENCE_SOURCES_NOT_CONFIGURED');
  const observations = [];
  for (const ref of config.references) {
    const chainId = await jsonRpc(ref.url, 'eth_chainId', []);
    if (hex(chainId) !== '0x1') throw new Error(`REFERENCE_WRONG_CHAIN:${ref.sourceId}`);
    const block = await jsonRpc(ref.url, 'eth_getBlockByNumber', ['finalized', false]);
    if (!block?.hash || !block?.number) throw new Error(`REFERENCE_FINALIZED_UNAVAILABLE:${ref.sourceId}`);
    observations.push({ ...ref, block });
  }
  if (observations[0].block.hash.toLowerCase() !== observations[1].block.hash.toLowerCase()) throw new Error('REFERENCE_HASH_CONFLICT');
  const block = observations[0].block;
  const references = [];
  for (const ref of observations) {
    const balance = await jsonRpc(ref.url, 'eth_getBalance', [address, { blockHash: block.hash, requireCanonical: true }]);
    if (!/^0x[0-9a-f]+$/i.test(balance)) throw new Error(`REFERENCE_BAD_BALANCE:${ref.sourceId}`);
    references.push({ sourceId: ref.sourceId, operatorId: ref.operatorId, observedBlockHash: block.hash, fetchedAt: new Date().toISOString(), balanceWei: BigInt(balance).toString() });
  }
  if (references[0].balanceWei !== references[1].balanceWei) throw new Error('REFERENCE_BALANCE_CONFLICT');
  return { sourceChainId: '1', blockNumber: BigInt(block.number).toString(), blockHash: block.hash, blockTimestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), capturedAt: new Date().toISOString(), tag: 'finalized', assurance: 'RPC_CROSS_CHECKED', references };
}

export async function readProviderBalance(service, address, snapshot) {
  if (!service.origin) throw new Error(`SERVICE_NOT_CONFIGURED:${service.id}`);
  const value = await jsonRpc(service.origin, 'eth_getBalance', [address, { blockHash: snapshot.blockHash, requireCanonical: true }]);
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error('PROVIDER_BAD_BALANCE');
  return { balanceWei: BigInt(value).toString(), observation: { kind: 'REQUEST_BOUND', blockHash: snapshot.blockHash, address, method: 'eth_getBalance' } };
}
