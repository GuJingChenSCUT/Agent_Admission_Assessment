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
  assert.equal(await page.locator("#state-pill").textContent(), "验收通过");
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
  assert.equal(await page.locator("#state-pill").textContent(), "已停止");
  assert.doesNotMatch(await page.locator("#result-value").textContent(), /ETH/);
  const recorded = JSON.parse(
    await fs.readFile("artifacts/live/ui-bundle.json", "utf8"),
  );
  const seek = async (value) => page.locator("#seek").fill(String(value));
  const noClock = async () => {
    assert.equal(await page.locator("#elapsed, #timecode, time").count(), 0);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /演练|模拟|\b\d{2}:\d{2}\b/,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  };
  for (const prefix of [
    base + "/",
    pathToFileURL(path.resolve("web")).href + "/",
  ]) {
    await page.goto(prefix + "demo-film.html");
    assert.equal(await page.locator("#seek").getAttribute("max"), "54");
    assert.equal(await page.locator("#prompt").inputValue(), "");
    assert.equal(await page.locator("#evidence-panel").isVisible(), false);
    await noClock();
    await seek(13);
    assert.equal(
      await page.locator("#status-pill").textContent(),
      "解析范围中",
    );
    assert.match(
      await page.locator("#prompt").inputValue(),
      /零地址.*0x0000000000000000000000000000000000000000/,
    );
    await seek(18);
    assert.equal(await page.locator("#scope-panel").isVisible(), true);
    assert.equal(await page.locator("#evidence-panel").isVisible(), false);
    await seek(24);
    assert.equal(
      await page.locator("#block-hash").textContent(),
      recorded.report.snapshot.blockHash,
    );
    await seek(28);
    assert.equal(await page.locator("#check-rows .check-row").count(), 1);
    await seek(34);
    assert.equal(await page.locator("#query-strip").isVisible(), true);
    assert.equal(await page.locator("#evidence-panel").isVisible(), false);
    await seek(38);
    assert.equal(await page.locator("#check-rows .check-row").count(), 3);
    await seek(48);
    assert.equal(await page.locator("#evidence-panel").isVisible(), true);
    assert.match(
      await page.locator("#fact-detail").textContent(),
      new RegExp(recorded.report.acceptedFact.balanceWei),
    );
    assert.equal(
      await page.locator("#report-hash").textContent(),
      recorded.reportHash,
    );
    await noClock();
    const pending = page.waitForEvent("download");
    await page.locator("#download").click();
    const saved = await pending;
    assert.deepEqual(
      JSON.parse(await fs.readFile(await saved.path(), "utf8")),
      recorded,
    );
    await seek(8);
    assert.equal(await page.locator("#evidence-panel").isVisible(), false);
    await page.locator("#play").click();
    await page.clock.runFor(1500);
    await page.locator("#play").click();
    const frozen = await page.locator("#seek").inputValue();
    await page.clock.runFor(2000);
    assert.equal(await page.locator("#seek").inputValue(), frozen);
    await seek(53);
    await page.locator("#play").click();
    await page.clock.runFor(2000);
    assert.equal(await page.locator("#seek").inputValue(), "54");
    assert.equal(await page.locator("#play").textContent(), "重播 ▶");
    await page.goto(prefix + "promo.html");
    assert.equal(await page.locator("#seek").getAttribute("max"), "56");
    assert.equal(await page.locator("textarea").count(), 0);
    for (const t of [0, 8, 16, 25, 35, 45, 52]) {
      await seek(t);
      assert.equal(await page.locator(".promo-scene:visible").count(), 1);
      const opacity = await page
        .locator(".promo-scene:visible")
        .evaluate((n) => getComputedStyle(n).opacity);
      assert.equal(opacity, "1");
      await noClock();
    }
    await seek(55);
    await page.locator("#play").click();
    await page.clock.runFor(2000);
    assert.equal(await page.locator("#seek").inputValue(), "56");
  }
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [name, points] of [
      ["demo-film", [0, 13, 18, 24, 30, 38, 48]],
      ["promo", [0, 8, 16, 25, 35, 45, 52]],
    ]) {
      await page.goto(base + "/" + name + ".html");
      for (const t of points) {
        await seek(t);
        await noClock();
        if (width > 900) {
          const clipped = await page.evaluate(() => {
            const parent = document
              .getElementById("film-stage")
              .getBoundingClientRect();
            const n = document.querySelector(
              ".operation-stage:not([hidden]) .work-card, .promo-scene:not([hidden])",
            );
            if (!n) return false;
            const r = n.getBoundingClientRect();
            return r.top < parent.top - 1 || r.bottom > parent.bottom + 1;
          });
          assert.equal(
            clipped,
            false,
            name + " clipped at " + t + " width " + width,
          );
        }
      }
      await page.screenshot({
        path: "artifacts/demos/" + name + "-" + width + ".png",
        fullPage: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "DEMO PASS: empty start, progressive execution, explicit approval, bounded cases, offline integrity, exact recorded bundle, sub-minute films, no timers, playback/reverse/pause/end, visible scenes, desktop/mobile, zero network.",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  app.store.close();
}
