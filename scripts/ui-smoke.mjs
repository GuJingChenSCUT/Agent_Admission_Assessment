// Optional UI check: install Playwright or set PLAYWRIGHT_MODULE to its file URL.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createApplication } from "../src/http-api.js";
import { TaskStore } from "../src/store.js";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const app = createApplication({
  store: new TaskStore(":memory:"),
  mode: "SAMPLE",
  stepMs: 180,
});
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + app.server.address().port;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const errors = [],
    externalRequests = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
    if (!request.url().startsWith(base)) externalRequests.push(request.url());
  });
  await fs.mkdir("artifacts/ui", { recursive: true });
  const click = (id) => page.locator("#" + id).click();
  const status = (value) =>
    page.waitForFunction(
      (value) => document.getElementById("status").textContent === value,
      value,
    );
  const reportReady = () =>
    page.waitForFunction(() => !document.getElementById("verify").disabled);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

  const waitConnected = () =>
    page.waitForFunction(
      () => document.getElementById("connection").textContent === "本地工作台",
    );
  const sampleInput =
    "请核对 0x2222222222222222222222222222222222222222 的 ETH 余额，使用执行时 finalized 区块。";
  await page.goto(base);
  await waitConnected();
  assert.equal(await page.locator("#intent").inputValue(), "");
  assert.equal(await page.locator("#create").isDisabled(), true);
  assert.equal(await page.locator("#run-panel").isVisible(), false);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  assert.equal(await page.locator("#pipeline").isVisible(), false);
  assert.equal(await page.locator("#banner").isVisible(), false);
  assert.equal(await page.locator("#providers").textContent(), "");
  assert.equal(
    requests.some(
      (r) =>
        r.method === "POST" ||
        /integrations|deployment|tasks|model/.test(r.url),
    ),
    false,
  );
  assert.match(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily),
    /Huawen ZhongSong/,
  );
  await noOverflow();
  await page.screenshot({ path: "artifacts/ui/desktop.png", fullPage: true });
  await page.locator("#story").screenshot({ path: "artifacts/ui/story.png" });
  await page.fill("#intent", sampleInput);
  await click("create");
  await page.waitForFunction(() => !document.getElementById("error").hidden);
  assert.match(await page.locator("#error").textContent(), /实际任务暂不可用/);
  assert.equal(await page.locator("#run-panel").isVisible(), false);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  await page.selectOption("#execution-kind", "SAMPLE");
  await page.locator("#scenario-control summary").click();
  await page.selectOption("#scenario", "stale_primary");
  await click("create");
  await status("待批准");
  assert.equal(await page.locator("#providers").textContent(), "");
  assert.equal(await page.locator("#evidence").isVisible(), false);
  await click("approve");
  await status("验收通过");
  await reportReady();
  assert.equal(await page.locator("#amount").textContent(), "42.125 ETH");
  assert.match(await page.locator("#providers").textContent(), /结果拒绝/);
  assert.match(await page.locator("#providers").textContent(), /备用数据服务/);
  await click("verify");
  await page.waitForFunction(
    () => document.getElementById("integrity").textContent === "内容摘要一致",
  );
  const originalReport = await page.locator("#report").textContent();
  await click("tamper");
  await page.waitForFunction(() =>
    document.getElementById("integrity").textContent.includes("篡改已检出"),
  );
  assert.equal(await page.locator("#report").textContent(), originalReport);
  const downloadPromise = page.waitForEvent("download");
  await click("download");
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^rpt_tsk_.*\.json$/);
  assert.equal(
    await fs.readFile(await download.path(), "utf8"),
    originalReport,
  );
  await page.locator("#workspace").screenshot({ path: "artifacts/ui/run.png" });

  await page.selectOption("#scenario", "both_fail");
  await click("create");
  await status("待批准");
  assert.equal(await page.locator("#report").textContent(), "");
  assert.equal(await page.locator("#download").isDisabled(), true);
  await click("approve");
  await status("验收未通过");
  await reportReady();
  assert.equal(await page.locator("#fact").isVisible(), false);
  await click("tamper");
  await page.waitForFunction(() =>
    document.getElementById("integrity").textContent.includes("篡改已检出"),
  );

  for (const [scenario, expected] of [
    ["normal", "验收通过"],
    ["reference_conflict", "结果已隔离"],
    ["manifest_changed", "验收通过"],
    ["optional_missing", "验收通过"],
  ]) {
    await page.selectOption("#scenario", scenario);
    await click("create");
    await status("待批准");
    await click("approve");
    await status(expected);
    await reportReady();
  }

  await page.selectOption("#scenario", "stale_primary");
  await page.uncheck("#fallback");
  await click("create");
  await status("待批准");
  await click("approve");
  await status("验收未通过");
  await reportReady();
  assert.match(await page.locator("#budget").textContent(), /切换 0 \/ 0/);
  await page.check("#fallback");

  await page.fill("#intent", "请查询 ETH 余额");
  await click("create");
  await status("待补充信息");
  await page.fill(
    "#answer",
    "请核对 0x2222222222222222222222222222222222222222 的 ETH 余额",
  );
  await click("clarify");
  await status("待批准");
  await click("approve");
  await click("stop");
  await status("已停止");
  await reportReady();

  // A stale task refresh arriving after stop must not restore RUNNING or the stop button.
  await page.selectOption("#scenario", "stale_primary");
  await page.fill(
    "#intent",
    "请核对 0x2222222222222222222222222222222222222222 的 ETH 余额",
  );
  await click("create");
  await status("待批准");
  let releaseRefresh,
    refreshArrived = false;
  const holdRefresh = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route(/\/v1\/tasks\/tsk_[a-f0-9]+$/, async (route) => {
    if (route.request().method() !== "GET" || refreshArrived)
      return route.continue();
    const response = await route.fetch();
    refreshArrived = true;
    await holdRefresh;
    await route.fulfill({ response });
  });
  await click("approve");
  for (let i = 0; i < 100 && !refreshArrived; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(refreshArrived, true);
  await click("stop");
  await status("已停止");
  releaseRefresh();
  await page.waitForTimeout(100);
  await page.unroute(/\/v1\/tasks\/tsk_[a-f0-9]+$/);
  assert.equal(await page.locator("#status").textContent(), "已停止");
  assert.equal(await page.locator("#stop").isDisabled(), true);
  await reportReady();

  // A late report for the previous task must not populate the new task's UI.
  let releaseReport,
    reportArrived = false;
  const holdReport = new Promise((resolve) => {
    releaseReport = resolve;
  });
  await page.route("**/v1/tasks/*/evidence", async (route) => {
    const response = await route.fetch();
    reportArrived = true;
    await holdReport;
    await route.fulfill({ response });
  });
  await page.fill(
    "#intent",
    "请核对 0x2222222222222222222222222222222222222222 的 ETH 余额",
  );
  await page.selectOption("#scenario", "normal");
  await click("create");
  await status("待批准");
  await click("approve");
  await status("验收通过");
  for (let i = 0; i < 100 && !reportArrived; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reportArrived, true);
  await click("create");
  await status("待批准");
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith("/evidence"),
  );
  releaseReport();
  await oldResponse;
  await page.unroute("**/v1/tasks/*/evidence");
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#report").textContent(), "");
  assert.equal(await page.locator("#evidence-body").isVisible(), false);
  assert.equal(await page.locator("#verify").isDisabled(), true);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(base);
  await waitConnected();
  await noOverflow();
  await page.screenshot({ path: "artifacts/ui/mobile.png", fullPage: true });
  await page.selectOption("#execution-kind", "SAMPLE");
  await page.locator("#scenario-control summary").click();
  await click("fill-example");
  await click("create");
  await status("待批准");
  await noOverflow();
  await click("approve");
  await status("验收通过");
  await reportReady();
  await noOverflow();
  await page.screenshot({
    path: "artifacts/ui/mobile-result.png",
    fullPage: true,
  });
  await click("new-task");
  assert.equal(await page.locator("#intent").inputValue(), "");
  assert.equal(await page.locator("#run-panel").isVisible(), false);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  assert.equal(await page.locator("#banner").isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(
    "UI PASS: empty start, explicit LIVE/SAMPLE, new task reset, local font, desktop/mobile, 6 scenarios, fallback bounds, clarification, stop, stale refresh isolation, report download, tamper, late report isolation, no external requests.",
  );

  const live = createApplication({
    store: new TaskStore(":memory:"),
    mode: "LIVE",
  });
  await new Promise((resolve) => live.server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto("http://127.0.0.1:" + live.server.address().port);
    await waitConnected();
    assert.equal(await page.locator("#create").isDisabled(), true);
    assert.equal(await page.locator("#scenario-control").isVisible(), false);
    assert.equal(await page.locator("#banner").isVisible(), false);
    await page.fill("#intent", sampleInput);
    await click("create");
    await page.waitForFunction(() => !document.getElementById("error").hidden);
    assert.equal(await page.locator("#run-panel").isVisible(), false);
    console.log("UI PASS: LIVE blocked state accurately displayed.");
  } finally {
    live.server.closeAllConnections();
    await new Promise((resolve) => live.server.close(resolve));
    live.store.close();
  }
} finally {
  await browser?.close();
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
  app.store.close();
}
