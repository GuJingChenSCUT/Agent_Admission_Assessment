import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createApplication } from "../src/http-api.js";
import { TaskStore } from "../src/store.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}),
});
const app = createApplication({
  store: new TaskStore(":memory:"),
  mode: "SAMPLE",
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
await fs.mkdir("artifacts/demos", { recursive: true });
const base = "http://127.0.0.1:" + app.server.address().port;
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    }),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("file:") && !r.url().startsWith(base))
      external.push(r.url());
  });
  await page.goto(pathToFileURL(path.resolve("web/demo.html")).href);
  await page.clock.install();
  assert.equal(await page.locator("#prompt").inputValue(), "");
  assert.equal(await page.locator("#scope").isVisible(), false);
  assert.equal(await page.locator("#result").isVisible(), false);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  assert.equal(await page.locator("#events li").count(), 0);
  await page.screenshot({
    path: "artifacts/demos/interactive-idle.png",
    fullPage: true,
  });
  await page.locator("#example").click();
  assert.equal(await page.locator("#events li").count(), 0);
  await page.locator("#submit").click();
  assert.equal(await page.locator("#state-pill").textContent(), "解析范围中");
  await page.clock.runFor(2300);
  assert.equal(await page.locator("#events li").count(), 2);
  assert.equal(await page.locator("#result").isVisible(), false);
  await page.clock.runFor(4300);
  assert.equal(await page.locator("#state-pill").textContent(), "等待批准");
  assert.equal(await page.locator("#scope").isVisible(), true);
  assert.equal(await page.locator("#attempts").textContent(), "");
  await page.clock.runFor(10000);
  assert.equal(await page.locator("#state-pill").textContent(), "等待批准");
  await page.locator("#approve").click();
  await page.clock.runFor(20000);
  assert.equal(await page.locator("#result").isVisible(), false);
  await page.clock.runFor(4000);
  assert.match(
    await page.locator("#attempts").textContent(),
    /交付区块与本次约定不符/,
  );
  await page.screenshot({
    path: "artifacts/demos/interactive-rejection.png",
    fullPage: true,
  });
  await page.clock.runFor(28000);
  assert.equal(await page.locator("#state-pill").textContent(), "演练验收通过");
  assert.equal(await page.locator("#result-value").textContent(), "42.125 ETH");
  await page.waitForFunction(() => !document.getElementById("tamper").disabled);
  const report = await page.locator("#report-json").textContent();
  await page.locator("#tamper").click();
  await page.waitForFunction(() =>
    document.getElementById("integrity").textContent.includes("篡改副本"),
  );
  assert.equal(await page.locator("#report-json").textContent(), report);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadPromise;
  const envelope = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  assert.equal(envelope.report.executionMode, "SAMPLE");
  assert.equal(
    envelope.integrity.digest,
    crypto
      .createHash("sha256")
      .update(JSON.stringify(envelope.report))
      .digest("hex"),
  );
  await page.locator("#reset").click();
  assert.equal(await page.locator("#prompt").inputValue(), "");
  await page.locator("#prompt").fill("帮我查询 ETH 余额");
  await page.locator("#submit").click();
  await page.clock.runFor(2500);
  assert.equal(await page.locator("#state-pill").textContent(), "待补充信息");
  assert.equal(await page.locator("#evidence").isVisible(), false);
  await page.locator("#example").click();
  await page.locator("#submit").click();
  await page.clock.runFor(6500);
  await page.locator("#approve").click();
  await page.clock.runFor(17000);
  await page.locator("#stop").click();
  await page.clock.runFor(60000);
  assert.equal(await page.locator("#state-pill").textContent(), "演练已停止");
  assert.doesNotMatch(await page.locator("#result-value").textContent(), /ETH/);
  await page.goto(base + "/demo-film.html");
  const seek = async (value) => {
    await page.locator("#seek").fill(String(value));
  };
  assert.equal(await page.locator("#prompt").inputValue(), "");
  assert.equal(await page.locator("#result").isVisible(), false);
  await seek(21);
  assert.equal(await page.locator("#state-pill").textContent(), "解析范围中");
  await seek(28);
  assert.equal(await page.locator("#scope").isVisible(), true);
  assert.equal(await page.locator("#result").isVisible(), false);
  await page.screenshot({
    path: "artifacts/demos/film-approval.png",
    fullPage: true,
  });
  await seek(61);
  assert.match(
    await page.locator("#attempts").textContent(),
    /交付区块与本次约定不符/,
  );
  assert.equal(await page.locator("#result").isVisible(), false);
  await seek(96);
  assert.equal(await page.locator("#state-pill").textContent(), "演练验收通过");
  await page.waitForFunction(() =>
    document.getElementById("integrity").textContent.includes("原件摘要一致"),
  );
  await seek(101);
  await page.waitForFunction(() =>
    document.getElementById("integrity").textContent.includes("篡改副本"),
  );
  await page.screenshot({
    path: "artifacts/demos/film-evidence.png",
    fullPage: true,
  });
  await seek(10);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  assert.equal(await page.locator("#attempts").textContent(), "");
  await page.locator("#play").click();
  await page.clock.runFor(1200);
  await page.locator("#play").click();
  const frozen = await page.locator("#seek").inputValue();
  await page.clock.runFor(3000);
  assert.equal(await page.locator("#seek").inputValue(), frozen);
  await page.setViewportSize({ width: 390, height: 844 });
  await seek(101);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "artifacts/demos/film-mobile.png",
    fullPage: true,
  });
  await page.goto(pathToFileURL(path.resolve("web/demo-film.html")).href);
  await seek(110);
  assert.equal(await page.locator("#state-pill").textContent(), "演练验收通过");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "DEMO PASS: file/HTTP, empty start, progressive parsing, explicit approval, delayed result, rejection/fallback, stop, reset, missing input, offline SHA-256, download, film seek/pause/reverse, mobile, zero network.",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  app.store.close();
}
