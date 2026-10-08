import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_PROMPT,
  DEMO_HASH,
  SCENARIOS,
  parseDemoPrompt,
  executionEvents,
  validateDemoObservation,
} from "../web/demo-src/model.js";
test("offline demo parses real user input, preserves fallback limits and asks for missing scope", () => {
  assert.equal(parseDemoPrompt("查询 ETH 余额").ok, false);
  assert.equal(parseDemoPrompt(DEMO_PROMPT.replace("ETH", "USDT")).ok, false);
  assert.equal(parseDemoPrompt(DEMO_PROMPT + " 0x" + "3".repeat(40)).ok, false);
  assert.equal(
    parseDemoPrompt("对 0x" + "2".repeat(40) + " 做安全审计").ok,
    false,
  );
  const spec = parseDemoPrompt(DEMO_PROMPT + " 不要切换").spec;
  assert.equal(spec.maxProviderCalls, 1);
  assert.equal(spec.maxFallbacks, 0);
  assert.equal(parseDemoPrompt(DEMO_PROMPT, false).spec.allowFallback, false);
});
test("offline demo events do not reveal accepted fact before verification, all branches stay bounded", () => {
  for (const scenario of Object.keys(SCENARIOS))
    for (const fallback of [true, false]) {
      const spec = parseDemoPrompt(DEMO_PROMPT, fallback).spec,
        events = executionEvents(spec, scenario),
        end = events.at(-1);
      assert.ok(events.every((e, i) => !i || e.at > events[i - 1].at));
      assert.ok(events.slice(0, -1).every((e) => !e.fact && !e.terminal));
      assert.ok(
        Math.max(...events.map((e) => e.calls || 0)) <= spec.maxProviderCalls,
      );
      assert.ok(
        Math.max(...events.map((e) => e.switches || 0)) <= spec.maxFallbacks,
      );
      assert.ok(end.terminal);
      if (end.terminal === "SUCCEEDED") {
        assert.ok(
          validateDemoObservation(spec, end.fact).every(
            (c) => c.status === "PASS",
          ),
        );
        assert.equal(end.fact.blockHash, DEMO_HASH);
      } else assert.equal(end.fact, undefined);
      if (scenario === "reference_conflict")
        assert.equal(
          events.some((e) => e.attempt),
          false,
        );
      if (scenario === "stale_primary" && !fallback)
        assert.equal(end.terminal, "FAILED");
      if (scenario === "rate_limited" && !fallback)
        assert.equal(end.terminal, "QUARANTINED");
    }
});
