import { hashCanonical } from "./domain.js";
import { endpoint } from "./net.js";

// The manifest is an administrator's configuration statement, not remote provenance.
export function liveConfig(env = process.env) {
  const referenceA =
    env.AA_REFERENCE_RPC_A || "https://ethereum-rpc.publicnode.com";
  const referenceB = env.AA_REFERENCE_RPC_B || "https://eth.drpc.org";
  const operator = (url, label) =>
    label ||
    (() => {
      try {
        return (
          "rpc_" +
          new URL(url).hostname.replace(/[^a-z0-9_-]/g, "_").slice(0, 100)
        );
      } catch {
        return "invalid";
      }
    })();
  const makeService = (id, origin, operatorId) => {
    const manifest = {
      version: "1",
      id,
      operatorId,
      transport: "HTTP_RPC",
      sourceChainId: "1",
      method: "eth_getBalance",
      blockParameter: "EIP_1898",
      endpointHash: hashCanonical(origin),
    };
    return Object.freeze({
      id,
      origin,
      operatorId,
      manifest,
      manifestHash: hashCanonical(manifest),
    });
  };
  const services = [
    makeService(
      "svc_primary",
      env.AA_PRIMARY_RPC || referenceA,
      operator(
        env.AA_PRIMARY_RPC || referenceA,
        env.AA_PRIMARY_OPERATOR || env.AA_REFERENCE_OPERATOR_A,
      ),
    ),
    makeService(
      "svc_backup",
      env.AA_BACKUP_RPC || referenceB,
      operator(
        env.AA_BACKUP_RPC || referenceB,
        env.AA_BACKUP_OPERATOR || env.AA_REFERENCE_OPERATOR_B,
      ),
    ),
  ];
  const references = [
    {
      sourceId: "ref_a",
      operatorId: operator(referenceA, env.AA_REFERENCE_OPERATOR_A),
      url: referenceA,
    },
    {
      sourceId: "ref_b",
      operatorId: operator(referenceB, env.AA_REFERENCE_OPERATOR_B),
      url: referenceB,
    },
  ];
  let error = null;
  try {
    for (const url of [
      ...references.map((r) => r.url),
      ...services.map((s) => s.origin),
    ])
      endpoint(url);
    if (
      [...services, ...references].some(
        (s) => !/^[a-z][a-z0-9_:-]{2,127}$/.test(s.operatorId),
      )
    )
      throw Error("OPERATOR_LABEL_INVALID");
    if (
      new URL(referenceA).hostname === new URL(referenceB).hostname ||
      references[0].operatorId === references[1].operatorId
    )
      throw Error("REFERENCE_SOURCES_NOT_DISTINCT");
  } catch (e) {
    error = e.code || "REFERENCE_SOURCES_NOT_DISTINCT";
  }
  return Object.freeze({
    enabled: env.AA_ENABLE_LIVE !== "false",
    ready: env.AA_ENABLE_LIVE !== "false" && !error,
    error,
    services: Object.freeze(services),
    references: Object.freeze(references),
    timeoutMs: 12000,
    maxRpcRequests: 18,
    maxReferenceHeadSkewBlocks: 32,
    maxRunMs: 180000,
    maxResponseBytes: 1024 * 1024,
  });
}
