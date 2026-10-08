import crypto from "node:crypto";
import { liveConfig } from "./live-config.js";
import { requestJson, failure } from "./net.js";
import { hashCanonical, makeRuleCheck } from "./domain.js";
import { config as baseConfig } from "./config.js";
import { dependencySnapshot, inspectPackages } from "./inspection/pnpm.js";
import {
  createRpcClient,
  resolveSnapshot,
  probeService,
  readBalance,
} from "./live-rpc.js";

export function createLiveRuntime({
  config = liveConfig(),
  request = requestJson,
  dependencies = dependencySnapshot,
} = {}) {
  const describe = () => ({
    version: "live-v1",
    services: config.services.map((s) => s.manifest),
    references: config.references.map((r) => ({
      sourceId: r.sourceId,
      operatorId: r.operatorId,
      endpointHash: hashCanonical(r.url),
    })),
    maxRpcRequests: config.maxRpcRequests,
    maxReferenceHeadSkewBlocks: config.maxReferenceHeadSkewBlocks,
    maxRunMs: config.maxRunMs,
    timeoutMs: config.timeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    dependencyScope: "PNPM_PRODUCTION_CLOSURE",
    osvMaxRequests: 20,
  });
  const binding = () => ({
    configHash: hashCanonical(describe()),
    dependencyDigest: dependencies().digest,
  });
  function assertBinding(task) {
    if (!config.ready) throw failure("LIVE_RUNTIME_NOT_CONFIGURED");
    if (hashCanonical(binding()) !== hashCanonical(task.liveBinding || {}))
      throw failure("LIVE_BINDING_CHANGED");
  }
  return {
    ready: config.ready,
    services: config.services.map((s) => ({
      id: s.id,
      operatorId: s.operatorId,
      manifestHash: s.manifestHash,
    })),
    bindTask(task) {
      if (!config.ready) throw failure("LIVE_RUNTIME_NOT_CONFIGURED");
      task.liveBinding = binding();
      task.serviceBindings = config.services.map((s) => ({
        id: s.id,
        operatorId: s.operatorId,
        manifestHash: s.manifestHash,
      }));
      task.policyHash = hashCanonical({
        policy: baseConfig.policy,
        live: describe(),
        ...task.liveBinding,
      });
      task.parser = "DETERMINISTIC_SCOPE_PARSER";
    },
    open(task, store, signal) {
      assertBinding(task);
      const deadline = AbortSignal.timeout(config.maxRunMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const record = (value) => {
        const bytes = Buffer.from(JSON.stringify(value));
        const digest =
          "0x" + crypto.createHash("sha256").update(bytes).digest("hex");
        const id = store.saveArtifact(task.taskId, bytes, digest);
        store.mutate(task.taskId, task.owner, (t) => {
          if (t.leaseGeneration !== task.leaseGeneration) return;
          t.artifactRefs ||= [];
          if (!t.artifactRefs.includes(id)) t.artifactRefs.push(id);
        });
        return id;
      };
      record({
        kind: "RUN_BINDING",
        ...task.liveBinding,
        config: describe(),
        packages: dependencies().packages,
        observedAt: new Date().toISOString(),
      });
      const inputs = dependencies().inputs;
      if (inputs)
        record({
          kind: "DEPENDENCY_INPUT",
          digest: task.liveBinding.dependencyDigest,
          inputs,
        });
      const rpc = createRpcClient({
        config,
        request,
        record,
        signal: combined,
      });
      let dependencyResult,
        dependencyRefs = [],
        referenceRefs = [];
      async function scan() {
        if (!dependencyResult) {
          const pinned = dependencies();
          if (pinned.digest !== task.liveBinding.dependencyDigest)
            throw failure("LIVE_BINDING_CHANGED");
          dependencyResult = await inspectPackages(
            pinned.packages,
            async (path, body) => {
              const response = await request("https://api.osv.dev" + path, {
                body,
                signal: combined,
                timeoutMs: config.timeoutMs,
                maxBytes: config.maxResponseBytes,
              });
              dependencyRefs.push(
                record({
                  kind: "OSV",
                  path,
                  request: body || null,
                  fetchedAt: new Date().toISOString(),
                  responseBase64: response.rawBytes.toString("base64"),
                }),
              );
              return response.body;
            },
          );
          dependencyRefs.push(
            record({
              kind: "DEPENDENCY_SCAN",
              digest: pinned.digest,
              scope: "PNPM_PRODUCTION_CLOSURE",
              ...dependencyResult,
              checkedAt: new Date().toISOString(),
            }),
          );
        }
        return dependencyResult;
      }
      return {
        services: config.services,
        async resolveSnapshot(address) {
          const snapshot = await resolveSnapshot(
            address,
            config.references,
            rpc,
            config.maxReferenceHeadSkewBlocks,
          );
          referenceRefs = [
            ...(store.get(task.taskId, task.owner).artifactRefs || []),
          ];
          return snapshot;
        },
        async admission(current, service) {
          assertBinding(current);
          const pinned = current.serviceBindings.find(
            (s) => s.id === service.id,
          );
          const checks = [
            makeRuleCheck(
              "manifest_pin",
              pinned?.manifestHash === service.manifestHash ? "PASS" : "FAIL",
              true,
              "CONFIG_MANIFEST_PINNED",
              pinned?.manifestHash || null,
              service.manifestHash,
            ),
            makeRuleCheck(
              "reference_consensus",
              "PASS",
              true,
              "REFERENCE_CROSS_CHECKED",
              "same finalized block and balance",
              current.snapshot.blockHash,
              "REFERENCE_RPC",
            ),
          ];
          checks[1].evidenceRefs = referenceRefs;
          const scanResult = await scan();
          const dep = makeRuleCheck(
            "client_dependency_policy",
            scanResult.status,
            true,
            scanResult.reason,
            "no known advisory in pinned production dependency closure",
            `${dependencies().packages.length} packages; ${scanResult.findings.length} findings; ${current.liveBinding.dependencyDigest}`,
          );
          dep.evidenceRefs = dependencyRefs;
          checks.push(dep);
          if (scanResult.status === "PASS") {
            try {
              const refs = await probeService(service, current.snapshot, rpc);
              const check = makeRuleCheck(
                "capability_match",
                "PASS",
                true,
                "CHAIN_AND_BLOCK_PROBED",
                "Ethereum chain 1 and pinned header",
                "EIP-1898 balance support is tested only by the budgeted invocation",
              );
              check.evidenceRefs = refs;
              checks.push(check);
            } catch (e) {
              const mismatch = [
                "PROVIDER_WRONG_CHAIN",
                "PROVIDER_BLOCK_MISMATCH",
              ].includes(e.code);
              checks.push(
                makeRuleCheck(
                  "capability_match",
                  mismatch ? "FAIL" : "INCONCLUSIVE",
                  true,
                  e.code || "RPC_UNAVAILABLE",
                  "Ethereum chain 1 and pinned header",
                  null,
                ),
              );
            }
          } else
            checks.push(
              makeRuleCheck(
                "capability_match",
                "NOT_CHECKED",
                true,
                "DEPENDENCY_GATE_CLOSED",
                "Ethereum chain 1 and pinned header",
                null,
              ),
            );
          checks.push(
            makeRuleCheck(
              "remote_deployment_provenance",
              "NOT_CHECKED",
              false,
              "PROVENANCE_NOT_AVAILABLE",
              "proved remote deployment",
              null,
              "NOT_AVAILABLE",
            ),
          );
          return checks;
        },
        async readBalance(service, address, snapshot) {
          assertBinding(store.get(task.taskId, task.owner));
          return readBalance(service, address, snapshot, rpc);
        },
        finish() {
          store.mutate(task.taskId, task.owner, (t) => {
            if (t.leaseGeneration === task.leaseGeneration)
              t.networkCounts = {
                ...rpc.counts,
                osv: dependencyResult?.requests || 0,
              };
          });
        },
      };
    },
  };
}
