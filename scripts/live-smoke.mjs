// Explicit network acceptance run. Never executed by pnpm test or the UI on load.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createApplication } from "../src/http-api.js";
import { createLiveRuntime } from "../src/live-runtime.js";
import { TaskStore } from "../src/store.js";
import { hashCanonical } from "../src/domain.js";

const app = createApplication({
  store: new TaskStore(":memory:"),
  mode: "LIVE",
  liveRuntime: createLiveRuntime(),
  stepMs: 0,
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + app.server.address().port;
try {
  const response = await fetch(base + "/v1/session"),
    session = await response.json();
  const headers = {
    cookie: response.headers.get("set-cookie").split(";")[0],
    "content-type": "application/json",
    "x-csrf-token": session.csrfToken,
  };
  const api = async (path, body) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...headers,
        "idempotency-key": "live-smoke-" + crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.ok(res.ok, JSON.stringify(data));
    return data;
  };
  let task = await api("/v1/tasks", {
    text: "查询以太坊主网 0x0000000000000000000000000000000000000000 的 ETH 余额，使用 finalized 区块",
    executionMode: "LIVE",
    allowFallback: true,
  });
  const path = "/v1/tasks/" + task.taskId;
  assert.equal(task.snapshot, null);
  assert.equal(task.attempts.length, 0);
  await api(path + "/approve", {
    revision: task.revision,
    specHash: task.specHash,
    approvalNonce: task.approvalNonce,
  });
  const deadline = Date.now() + 200000;
  do {
    await new Promise((r) => setTimeout(r, 250));
    task = await api(path);
    if (Date.now() > deadline) throw Error("LIVE_SMOKE_TIMEOUT");
  } while (
    !["SUCCEEDED", "QUARANTINED", "FAILED", "CANCELLED"].includes(task.status)
  );
  while (app.running.size) await new Promise((r) => setTimeout(r, 10));
  const bundle = await api(path + "/evidence-bundle");
  assert.equal(bundle.report.executionMode, "LIVE");
  assert.equal(hashCanonical(bundle.report), bundle.reportHash);
  for (const art of bundle.artifacts)
    assert.equal(
      "0x" +
        crypto
          .createHash("sha256")
          .update(Buffer.from(art.base64, "base64"))
          .digest("hex"),
      art.sha256,
    );
  const check = await api("/v1/public/evidence/verify", {
    report: bundle.report,
    reportHash: bundle.reportHash,
  });
  assert.equal(check.integrity, "PASS");
  await fs.mkdir("artifacts/live", { recursive: true });
  await fs.writeFile(
    "artifacts/live/" + task.taskId + ".json",
    JSON.stringify(bundle, null, 2),
  );
  await fs.writeFile(
    "artifacts/live/latest-report.json",
    JSON.stringify(bundle, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: task.status,
        block: task.snapshot?.blockNumber,
        hash: task.snapshot?.blockHash,
        balanceWei: task.acceptedFact?.balanceWei,
        networkCounts: bundle.networkCounts,
        reportHash: bundle.reportHash,
        events: task.events.map((e) => ({ type: e.type, ...e.details })),
        failures: task.attempts.flatMap((a) =>
          a.checks
            .filter((c) => c.required && c.status !== "PASS")
            .map((c) => c.reasonCode),
        ),
      },
      null,
      2,
    ),
  );
  assert.equal(
    task.status,
    "SUCCEEDED",
    "Real network run did not pass; inspect report, never replace it with SAMPLE.",
  );
} finally {
  app.abortAll();
  while (app.running.size) await new Promise((r) => setTimeout(r, 50));
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  app.store.close();
}
