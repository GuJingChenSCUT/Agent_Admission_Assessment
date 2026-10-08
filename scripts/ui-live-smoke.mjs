// Explicit real UI + network test; public zero address only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tasks = [];
  page.on("request", (r) => {
    if (r.method() === "POST") tasks.push(r.url());
  });
  await page.goto(process.env.AA_UI_URL || "http://127.0.0.1:8787/");
  await page.waitForFunction(
    () => document.getElementById("connection").textContent === "本地工作台",
  );
  assert.equal(await page.locator("#intent").inputValue(), "");
  assert.equal(await page.locator("#run-panel").isVisible(), false);
  assert.equal(await page.locator("#evidence").isVisible(), false);
  assert.equal(tasks.length, 0);
  await page
    .locator("#intent")
    .fill(
      "核验以太坊主网 0x0000000000000000000000000000000000000000 的原生 ETH 余额，使用执行时 finalized 区块",
    );
  await page.locator("#create").click();
  await page.waitForFunction(
    () => document.getElementById("status").textContent === "待批准",
  );
  assert.equal(await page.locator("#providers").textContent(), "");
  await page.locator("#approve").click();
  await page.waitForFunction(
    () =>
      ["验收通过", "结果已隔离", "验收未通过"].includes(
        document.getElementById("status").textContent,
      ),
    null,
    { timeout: 195000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("download").disabled,
  );
  const report = JSON.parse(await page.locator("#report").textContent());
  await fs.mkdir("artifacts/live", { recursive: true });
  await page
    .locator("#workspace")
    .screenshot({ path: "artifacts/live/ui-live.png" });
  const download = page.waitForEvent("download");
  await page.locator("#download").click();
  await (await download).saveAs("artifacts/live/ui-bundle.json");
  console.log(
    JSON.stringify({
      result: report.report.result,
      block: report.report.snapshot?.blockNumber,
      balanceWei: report.report.acceptedFact?.balanceWei,
      reportHash: report.reportHash,
      errors,
    }),
  );
  assert.equal(report.report.executionMode, "LIVE");
  assert.equal(report.report.result, "SUCCEEDED");
  assert.deepEqual(errors, []);
  await page.locator("#new-task").click();
  assert.equal(await page.locator("#intent").inputValue(), "");
  assert.equal(await page.locator("#evidence").isVisible(), false);
} finally {
  await browser.close();
}
