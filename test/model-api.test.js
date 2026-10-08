import test from "node:test";
import assert from "node:assert/strict";
import { extractModelDraft } from "../src/model-api.js";
import { parseIntent } from "../src/domain.js";
import { createApplication } from "../src/http-api.js";
import { TaskStore } from "../src/store.js";

const text = "核对 0x2222222222222222222222222222222222222222 的 ETH 余额";
const valid = () => parseIntent(text, false);
test("PI draft boundary: no adapter means no fabricated model result", async () => {
  await assert.rejects(
    extractModelDraft({ adapter: null, text, allowFallback: false }),
    { message: "PI_ADAPTER_NOT_CONFIGURED", status: 503 },
  );
});
test("PI draft boundary: validates schema, user address, scope and fallback permission", async () => {
  for (const change of [
    (draft) => ({
      ...draft,
      address: "0x3333333333333333333333333333333333333333",
    }),
    (draft) => ({ ...draft, sourceChainId: "677" }),
    (draft) => ({ ...draft, allowFallback: true }),
    (draft) => ({ ...draft, shell: "untrusted output" }),
  ]) {
    await assert.rejects(
      extractModelDraft({
        adapter: { extract: async () => change(valid()) },
        text,
        allowFallback: false,
      }),
      (error) =>
        ["MODEL_SCOPE_VIOLATION", "MODEL_DRAFT_INVALID"].includes(
          error.message,
        ),
    );
  }
  await assert.rejects(
    extractModelDraft({
      adapter: { extract: async () => valid() },
      text: "查询某个地址",
      allowFallback: false,
    }),
    { message: "MODEL_SCOPE_VIOLATION" },
  );
  await assert.rejects(
    extractModelDraft({
      adapter: { extract: async () => valid() },
      text: text + "并转账",
      allowFallback: false,
    }),
    { message: "MODEL_SCOPE_VIOLATION" },
  );
});
test("PI draft boundary: timeout aborts adapter and provider errors are redacted", async () => {
  let signal;
  await assert.rejects(
    extractModelDraft({
      adapter: {
        extract: async (_, options) => {
          signal = options.signal;
          return new Promise(() => {});
        },
      },
      text,
      allowFallback: false,
      timeoutMs: 10,
    }),
    { message: "MODEL_TIMEOUT", status: 504 },
  );
  assert.equal(signal.aborted, true);
  await assert.rejects(
    extractModelDraft({
      adapter: {
        extract: async () => {
          throw Error("provider-url?secret=not-for-browser");
        },
      },
      text,
      allowFallback: false,
    }),
    { message: "MODEL_UPSTREAM_FAILED", status: 502 },
  );
});
test("PI draft boundary: already cancelled requests do not invoke the model", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    extractModelDraft({
      adapter: {
        extract: async () => {
          calls++;
          return valid();
        },
      },
      text,
      allowFallback: false,
      signal: controller.signal,
    }),
    { message: "MODEL_REQUEST_ABORTED" },
  );
  assert.equal(calls, 0);
});
test("HTTP: PI invokes only on explicit POST; draft cannot start a task or execute tools", async (t) => {
  let calls = 0;
  const store = new TaskStore(":memory:");
  const app = createApplication({
    store,
    mode: "SAMPLE",
    modelAdapter: {
      extract: async (input, options) => {
        calls++;
        assert.equal(input, text);
        assert.equal(options.maxOutputTokens, 2048);
        return valid();
      },
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    store.close();
  });
  const base = "http://127.0.0.1:" + app.server.address().port;
  assert.equal((await fetch(base + "/v1/model")).status, 401);
  const sessionResponse = await fetch(base + "/v1/session"),
    session = await sessionResponse.json();
  const headers = {
    cookie: sessionResponse.headers.get("set-cookie").split(";")[0],
    "content-type": "application/json",
  };
  const status = await (await fetch(base + "/v1/model", { headers })).json();
  assert.equal(status.adapterConfigured, true);
  assert.equal(status.canExecuteTools, false);
  assert.equal(calls, 0);
  const request = {
    method: "POST",
    headers,
    body: JSON.stringify({ text, allowFallback: false }),
  };
  assert.equal((await fetch(base + "/v1/model/drafts", request)).status, 403);
  request.headers = { ...headers, "x-csrf-token": session.csrfToken };
  const response = await fetch(base + "/v1/model/drafts", request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.executionStarted, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(calls, 1);
  assert.equal(store.list().length, 0);
  // Never allow browsers to choose upstream endpoints or send API credentials.
  assert.equal(
    (
      await fetch(base + "/v1/model/drafts", {
        ...request,
        body: JSON.stringify({ text, baseURL: "http://localhost" }),
      })
    ).status,
    400,
  );
  assert.equal(calls, 1);
  const live = await fetch(base + "/v1/tasks", {
    ...request,
    body: JSON.stringify({ text, executionMode: "LIVE" }),
  });
  assert.equal(live.status, 503);
  assert.equal(store.list().length, 0);
});
