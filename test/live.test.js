import test from "node:test";
import assert from "node:assert/strict";
import { createLiveRuntime } from "../src/live-runtime.js";
import { liveConfig } from "../src/live-config.js";
import { TaskStore } from "../src/store.js";
import { makeTask, hashCanonical } from "../src/domain.js";
import { approve, renewApproval, stop } from "../src/control.js";
import { runTask } from "../src/runtime.js";
import { failure } from "../src/net.js";
import { validateDefinition } from "../src/schema.js";
import { createApplication } from "../src/http-api.js";
import {
  dependencySnapshot,
  productionPackages,
  inspectPackages,
} from "../src/inspection/pnpm.js";
import { quantity } from "../src/live-rpc.js";

const hash = "0x" + "ab".repeat(32),
  text = "查询 0x2222222222222222222222222222222222222222 的 ETH 余额";
const cfg = liveConfig({
  AA_REFERENCE_RPC_A: "https://ref-a.example.com/key-secret-a",
  AA_REFERENCE_RPC_B: "https://ref-b.example.com/key-secret-b",
  AA_PRIMARY_RPC: "https://primary.example.com/key-secret-c",
  AA_BACKUP_RPC: "https://backup.example.com/key-secret-d",
});
const deps = {
  digest: hash,
  packages: [{ name: "example", version: "1.0.0", ecosystem: "npm" }],
};
function fixture(options = {}) {
  const calls = [];
  const request = async (url, { body, signal }) => {
    calls.push({ url, body });
    if (signal.aborted) throw failure("REQUEST_ABORTED");
    if (url.startsWith("https://api.osv.dev")) {
      if (options.osvFail) throw failure("UPSTREAM_TIMEOUT");
      const data = url.endsWith("querybatch")
        ? { results: options.vuln ? [{ vulns: [{ id: "TEST-1" }] }] : [{}] }
        : { id: "TEST-1", modified: "2026-10-08", affected: [{}] };
      return { body: data, rawBytes: Buffer.from(JSON.stringify(data)) };
    }
    if (
      options.block &&
      body.method === "eth_getBalance" &&
      url.includes("primary.")
    ) {
      await options.block(signal);
    }
    if (
      options.rateLimit &&
      body.method === "eth_getBalance" &&
      url.includes("primary.")
    )
      throw failure("RATE_LIMITED");
    let result;
    const block = { hash, number: "0x64", timestamp: "0x67000000" };
    switch (body.method) {
      case "eth_chainId":
        result = options.wrongChain && url.includes("primary.") ? "0x2" : "0x1";
        break;
      case "eth_getBlockByNumber":
        result =
          body.params[0] === "finalized" && url.includes("ref-a.")
            ? {
                ...block,
                number: options.skew ? "0x100" : "0x65",
                hash: "0x" + "cc".repeat(32),
              }
            : block;
        if (options.conflict && url.includes("ref-b."))
          result = { ...block, hash: "0x" + "dd".repeat(32) };
        break;
      case "eth_getBlockByHash":
        result = block;
        break;
      case "eth_getBalance":
        result =
          options.wrongValue && url.includes("primary.") ? "0x2b" : "0x2a";
        break;
      default:
        throw Error("Unexpected method");
    }
    const data = {
      jsonrpc: "2.0",
      id: options.badId ? body.id + 1 : body.id,
      result,
    };
    return { body: data, rawBytes: Buffer.from(JSON.stringify(data)) };
  };
  return {
    calls,
    runtime: createLiveRuntime({
      config: { ...cfg, ...options.config },
      request,
      dependencies: options.dependencies || (() => deps),
    }),
  };
}
async function execute(t, options = {}) {
  const f = fixture(options),
    store = new TaskStore(":memory:");
  t.after(() => store.close());
  const task = makeTask({
    owner: "owner",
    text,
    mode: "LIVE",
    allowFallback: options.fallback ?? true,
  });
  f.runtime.bindTask(task);
  renewApproval(task);
  approve(
    task,
    {
      revision: task.revision,
      specHash: task.specHash,
      approvalNonce: task.approvalNonce,
    },
    "live-test-key",
  );
  store.put(task);
  if (options.beforeRun) options.beforeRun();
  const result = await runTask(task, store, {
    liveRuntime: f.runtime,
    stepMs: 0,
  });
  return { ...f, result: store.get(result.taskId, result.owner), store };
}

test("LIVE aligns finalized heights, preserves exact wei, probes before one dispatch, emits valid evidence", async (t) => {
  const { result, calls, store } = await execute(t);
  assert.equal(result.status, "SUCCEEDED", JSON.stringify(result.events));
  assert.equal(result.snapshot.blockNumber, "100");
  assert.equal(result.acceptedFact.balanceWei, "42");
  assert.deepEqual(result.networkCounts, {
    reference: 8,
    probe: 2,
    provider: 1,
    osv: 1,
  });
  assert.equal(result.attempts[0].observation.bindingKind, "REQUEST_BOUND");
  assert.equal(result.attempts[0].observation.providerDeclaredBlockHash, null);
  assert.equal(
    validateDefinition("PublicReport", result.report.report).valid,
    true,
  );
  assert.equal(hashCanonical(result.report.report), result.report.reportHash);
  assert.ok(result.artifactRefs.length > 10);
  const serialized = JSON.stringify([
    result,
    ...result.artifactRefs.map((id) =>
      Buffer.from(
        store.artifact(result.taskId, result.owner, id).base64,
        "base64",
      ).toString(),
    ),
  ]);
  assert.equal(serialized.includes("key-secret"), false);
  for (const c of calls.filter((c) => c.body?.method === "eth_getBalance"))
    assert.deepEqual(c.body.params[1], {
      blockHash: hash,
      requireCanonical: true,
    });
});
test("LIVE limit response is inconclusive and falls back within the original hash and budget", async (t) => {
  const { result } = await execute(t, { rateLimit: true });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.acceptedFact.serviceId, "svc_backup");
  assert.equal(result.attempts[0].status, "INCONCLUSIVE");
  assert.equal(result.attempts[0].checks.at(-1).reasonCode, "RATE_LIMITED");
  assert.deepEqual(result.networkCounts, {
    reference: 8,
    probe: 4,
    provider: 2,
    osv: 1,
  });
  assert.equal(result.counters.fallbacks, 1);
});
test("LIVE wrong value fails verification; wrong-chain candidate is rejected before dispatch", async (t) => {
  const badValue = await execute(t, { wrongValue: true, fallback: false });
  assert.equal(badValue.result.status, "FAILED");
  assert.equal(badValue.result.acceptedFact, null);
  const badChain = await execute(t, { wrongChain: true });
  assert.equal(badChain.result.status, "SUCCEEDED");
  assert.equal(badChain.result.attempts[0].status, "REJECTED");
  assert.equal(badChain.result.counters.providerCalls, 1);
});
test("LIVE reference conflict, OSV outage and malformed JSON-RPC cannot become PASS", async (t) => {
  for (const option of [
    { conflict: true },
    { skew: true },
    { osvFail: true },
    { badId: true },
  ]) {
    const { result } = await execute(t, option);
    assert.equal(result.status, "QUARANTINED");
    assert.equal(result.acceptedFact, null);
    assert.equal(result.counters.providerCalls, 0);
  }
});
test("LIVE known dependency advisory blocks candidates without probing or invoking them", async (t) => {
  const { result } = await execute(t, { vuln: true });
  assert.equal(result.status, "FAILED");
  assert.equal(result.networkCounts.probe, 0);
  assert.equal(result.counters.providerCalls, 0);
  assert.equal(
    result.attempts[0].checks.find(
      (c) => c.ruleId === "client_dependency_policy",
    ).reasonCode,
    "KNOWN_ADVISORY_FOUND",
  );
});
test("LIVE pinned dependency changes before execution are quarantined without network", async (t) => {
  let digest = hash;
  const { result, calls } = await execute(t, {
    dependencies: () => ({ ...deps, digest }),
    beforeRun: () => {
      digest = "0x" + "ef".repeat(32);
    },
  });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(calls.length, 0);
  assert.equal(result.events.at(-2).details.code, "LIVE_BINDING_CHANGED");
});
test("LIVE stop aborts transport and late results cannot produce accepted facts", async (t) => {
  let started, release;
  const dispatched = new Promise((r) => {
    started = r;
  });
  const wait = new Promise((r) => {
    release = r;
  });
  const controller = new AbortController();
  let seenSignal;
  const f = fixture({
    block: async (signal) => {
      seenSignal = signal;
      started();
      await wait;
    },
  });
  const store = new TaskStore(":memory:");
  t.after(() => store.close());
  const task = makeTask({ owner: "owner", text, mode: "LIVE" });
  f.runtime.bindTask(task);
  renewApproval(task);
  approve(
    task,
    {
      revision: task.revision,
      specHash: task.specHash,
      approvalNonce: task.approvalNonce,
    },
    "stop-live-key",
  );
  store.put(task);
  const running = runTask(task, store, {
    liveRuntime: f.runtime,
    signal: controller.signal,
    stepMs: 0,
  });
  await dispatched;
  store.mutate(task.taskId, task.owner, stop);
  controller.abort();
  release();
  await running;
  const result = store.get(task.taskId, task.owner);
  assert.equal(seenSignal.aborted, true);
  assert.equal(result.status, "CANCELLED");
  assert.equal(result.acceptedFact, null);
  assert.equal(result.counters.providerCalls, 1);
  assert.equal(result.attempts[0].status, "LATE_DISCARDED");
});
test("LIVE RPC budget is an enforced ceiling", async (t) => {
  const { result, calls } = await execute(t, { config: { maxRpcRequests: 3 } });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(calls.length, 3);
  assert.equal(result.events.at(-2).details.code, "RPC_BUDGET_EXHAUSTED");
});
test("LIVE total deadline cancels an in-flight dispatch without accepting it", async (t) => {
  const { result } = await execute(t, {
    config: { maxRunMs: 500 },
    block: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(failure("REQUEST_ABORTED")),
          { once: true },
        );
        if (signal.aborted) reject(failure("REQUEST_ABORTED"));
        // Keep the fixture event loop alive; real sockets do this in production.
        const timer = setTimeout(() => reject(failure("TEST_TIMEOUT")), 1000);
        signal.addEventListener("abort", () => clearTimeout(timer), {
          once: true,
        });
      }),
  });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(result.acceptedFact, null);
  assert.equal(result.counters.providerCalls, 1);
});
test("HTTP LIVE makes no external requests before approval, prevents injected scenarios, exports private bundle", async (t) => {
  const f = fixture(),
    app = createApplication({
      store: new TaskStore(":memory:"),
      mode: "LIVE",
      liveRuntime: f.runtime,
      stepMs: 0,
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    app.abortAll();
    while (app.running.size) await new Promise((r) => setTimeout(r, 5));
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    app.store.close();
  });
  const base = "http://127.0.0.1:" + app.server.address().port,
    res = await fetch(base + "/v1/session"),
    session = await res.json();
  const headers = {
    cookie: res.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": session.csrfToken,
    "content-type": "application/json",
    "idempotency-key": "http-live-key",
  };
  const api = async (path, body) => {
    const r = await fetch(base + path, {
      headers,
      method: body ? "POST" : "GET",
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  assert.equal(
    (
      await api("/v1/tasks", {
        text,
        executionMode: "LIVE",
        scenario: "normal",
      })
    ).status,
    400,
  );
  const created = await api("/v1/tasks", { text, executionMode: "LIVE" });
  assert.equal(created.status, 201);
  const task = created.body,
    path = "/v1/tasks/" + task.taskId;
  assert.equal(f.calls.length, 0);
  assert.equal(task.snapshot, null);
  assert.deepEqual(task.attempts, []);
  await api(path + "/approve", {
    revision: task.revision,
    specHash: task.specHash,
    approvalNonce: task.approvalNonce,
  });
  while (app.running.size) await new Promise((r) => setTimeout(r, 5));
  const bundle = (await api(path + "/evidence-bundle")).body;
  assert.equal(bundle.report.result, "SUCCEEDED");
  assert.ok(bundle.artifacts.length > 10);
  assert.equal(bundle.networkCounts.provider, 1);
  const other = await fetch(base + "/v1/session");
  assert.equal(
    (
      await fetch(base + path + "/evidence-bundle", {
        headers: { cookie: other.headers.get("set-cookie").split(";")[0] },
      })
    ).status,
    404,
  );
});
test("production closure excludes dev tools and rejects an unresolved transitive version", () => {
  const packages = dependencySnapshot().packages;
  assert.ok(packages.some((p) => p.name === "fast-deep-equal"));
  assert.equal(
    packages.some((p) => p.name === "typescript"),
    false,
  );
  const lock = {
    lockfileVersion: "9.0",
    importers: {
      ".": { dependencies: { foo: { specifier: "1.0.0", version: "1.0.0" } } },
    },
    packages: { "foo@1.0.0": { resolution: { integrity: "sha512-test" } } },
    snapshots: { "foo@1.0.0": { dependencies: { bar: "link:evil" } } },
  };
  assert.throws(
    () => productionPackages(lock, { dependencies: { foo: "1.0.0" } }),
    /UNRESOLVED/,
  );
});
test("OSV invalid batch, repeated page tokens and incomplete records remain inconclusive", async () => {
  for (const response of [
    null,
    { results: [] },
    { results: [{ vulns: null }] },
  ])
    assert.equal(
      (await inspectPackages(deps.packages, async () => response)).status,
      "INCONCLUSIVE",
    );
  const pages = await inspectPackages(deps.packages, async (path) =>
    path.endsWith("querybatch")
      ? { results: [{ next_page_token: "x" }] }
      : { next_page_token: "x" },
  );
  assert.equal(pages.reason, "OSV_PAGINATION_INVALID");
  const partial = await inspectPackages(deps.packages, async (path) =>
    path.endsWith("querybatch")
      ? { results: [{ vulns: [{ id: "TEST-1" }] }] }
      : { id: "TEST-1" },
  );
  assert.equal(partial.reason, "OSV_RECORD_INCOMPLETE");
});
test("RPC quantities reject noncanonical or oversized values without precision loss", () => {
  for (const v of ["0x00", "0x", "0xAB", 42, "0x" + "f".repeat(65)])
    assert.throws(() => quantity(v));
  assert.equal(quantity("0xffffffffffffffffffff"), 1208925819614629174706175n);
});
