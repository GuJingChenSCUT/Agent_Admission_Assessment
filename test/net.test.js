import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { endpoint, publicIp, requestJson } from "../src/net.js";

test("egress rejects local/private/special endpoints and addresses", () => {
  for (const url of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com:8443",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://localhost",
    "https://metadata.internal",
    "https://example.com/#fragment",
  ])
    assert.throws(() => endpoint(url));
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.2",
    "100.64.1.1",
    "203.0.113.1",
    "::1",
    "::ffff:8.8.8.8",
    "2001:0::1",
    "2001:db8::1",
    "2002:0808:0808::1",
    "fc00::1",
    "3fff::1",
  ])
    assert.equal(publicIp(ip), false, ip);
  assert.equal(publicIp("8.8.8.8"), true);
  assert.equal(publicIp("2606:4700:4700::1111"), true);
});
test("DNS with any private answer is denied before opening a socket", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  const send = t.mock.method(https, "request", () => {
    throw Error("must not connect");
  });
  await assert.rejects(
    requestJson("https://rpc.example.com"),
    /PRIVATE_NETWORK_DENIED/,
  );
  assert.equal(send.mock.callCount(), 0);
});
function mockResponse(
  t,
  { status = 200, body = '{"ok":true}', type = "application/json" } = {},
) {
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  let pinned;
  t.mock.method(https, "request", (url, options, callback) => {
    options.lookup(url.hostname, { all: true }, (err, addresses) => {
      pinned = addresses;
    });
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = status;
        res.headers = { "content-type": type };
        res.destroy = () => {};
        callback(res);
        res.emit("data", Buffer.from(body));
        res.emit("end");
      });
    return req;
  });
  return () => pinned;
}
test("TLS lookup uses checked DNS result; redirects, oversized and duplicate-key bodies are rejected", async (t) => {
  const pinned = mockResponse(t);
  assert.deepEqual((await requestJson("https://rpc.example.com")).body, {
    ok: true,
  });
  assert.deepEqual(pinned(), [{ address: "8.8.8.8", family: 4 }]);
  t.mock.restoreAll();
  for (const [options, code, maxBytes] of [
    [{ status: 302 }, "REDIRECT_DENIED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ body: '{"a":1,"a":2}' }, "UPSTREAM_JSON_INVALID"],
    [{ body: '{"a":"long"}' }, "RESPONSE_TOO_LARGE", 2],
    [{ type: "text/html" }, "CONTENT_TYPE_INVALID"],
  ]) {
    mockResponse(t, options);
    await assert.rejects(
      requestJson("https://rpc.example.com", { maxBytes }),
      new RegExp(code),
    );
    t.mock.restoreAll();
  }
});
test("DNS resolution timeout and pre-cancelled calls terminate without requests", async (t) => {
  t.mock.method(dns, "lookup", () => new Promise(() => {}));
  await assert.rejects(
    requestJson("https://rpc.example.com", { timeoutMs: 15 }),
    /UPSTREAM_TIMEOUT/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestJson("https://rpc.example.com", { signal: controller.signal }),
    /REQUEST_ABORTED/,
  );
});
