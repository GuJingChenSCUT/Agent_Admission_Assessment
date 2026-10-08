import fs from "node:fs/promises";
import crypto from "node:crypto";
const root = new URL("../", import.meta.url);
const read = async (file) => (await fs.readFile(new URL(file, root), "utf8")).replace(/\r\n/g, '\n');
const [shell, style, model, controller, workbench] = await Promise.all(
  [
    "web/demo-src/shell.html",
    "web/demo-src/style.css",
    "web/demo-src/model.js",
    "web/demo-src/controller.js",
    "web/index.html",
  ].map(read),
);
const harbor = workbench.match(/<svg\s+class="harbor-art"[\s\S]*?<\/svg>/)?.[0];
if (!harbor) throw Error("HARBOR_ASSET_NOT_FOUND");
const script =
  '"use strict";\n(()=>{\n' +
  model.replace(/^export /gm, "") +
  "\n" +
  controller +
  "\n})();";
if (/<\/script/i.test(script)) throw Error("INLINE_SCRIPT_TERMINATOR");
const hash = crypto.createHash("sha256").update(script).digest("base64");
for (const [mode, name, title, other, label] of [
  ["interactive", "demo.html", "交互演练", "demo-film.html", "观看定时演示"],
  ["film", "demo-film.html", "定时演示", "demo.html", "切换交互演练"],
]) {
  const values = {
    TITLE: title,
    MODE: mode,
    STYLE: style,
    HARBOR: harbor,
    SCRIPT: script,
    SCRIPT_HASH: hash,
    OTHER: other,
    OTHER_LABEL: label,
  };
  const html = shell.replace(/__([A-Z_]+)__/g, (_, key) => values[key]);
  await fs.writeFile(new URL("web/" + name, root), html);
  console.log(name + " · standalone · " + Buffer.byteLength(html) + " bytes");
}
