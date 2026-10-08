// Deterministic offline frame export; requires Playwright and an FFmpeg with VP8.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}),
});
await fs.mkdir("artifacts/films", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [name, out, duration] of [
    ["demo-film", "江汉验关-操作短片", 54],
    ["promo", "江汉验关-宣传片", 56],
  ]) {
    await page.goto(
      pathToFileURL(path.resolve("web/" + name + ".html")).href + "?export=1",
    );
    await page.evaluate(() => document.fonts.ready);
    const file = path.resolve("artifacts/films/" + out + ".webm");
    const fps = 12;
    const child = spawn(
      ffmpeg,
      [
        "-y",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-r",
        String(fps),
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libvpx",
        "-b:v",
        "2000k",
        "-deadline",
        "realtime",
        "-cpu-used",
        "5",
        file,
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-6000);
    });
    const completion = once(child, "close");
    for (let frame = 0; frame < duration * fps; frame++) {
      await page.locator("#seek").evaluate((node, value) => {
        node.value = String(value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }, frame / fps);
      const image = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!child.stdin.write(image)) await once(child.stdin, "drain");
      if (frame % (fps * 10) === 0)
        console.log(name + " frames " + frame + "/" + duration * fps);
    }
    child.stdin.end();
    const [code] = await completion;
    if (code !== 0) throw Error(stderr);
    console.log("EXPORTED " + file);
  }
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
}
