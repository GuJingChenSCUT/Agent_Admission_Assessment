import fs from "node:fs/promises";
import crypto from "node:crypto";
import { hashCanonical } from "../src/domain.js";
import { validateDefinition } from "../src/schema.js";
const root = new URL("../", import.meta.url);
const read = async (file) =>
  (await fs.readFile(new URL(file, root), "utf8")).replace(/\r\n/g, "\n");
const [
  shell,
  style,
  model,
  controller,
  harbor,
  cinemaShell,
  cinemaStyle,
  operation,
  promo,
  player,
  recorded,
] = await Promise.all(
  [
    "web/demo-src/shell.html",
    "web/demo-src/style.css",
    "web/demo-src/model.js",
    "web/demo-src/controller.js",
    "web/film-src/wuhan.svg",
    "web/film-src/shell.html",
    "web/film-src/style.css",
    "web/film-src/operation.html",
    "web/film-src/promo.html",
    "web/film-src/player.js",
    "artifacts/live/ui-bundle.json",
  ].map(read),
);
// Publishing claims in either film requires a valid saved LIVE observation.
const bundle = JSON.parse(recorded);
if (
  !validateDefinition("PublicReport", bundle.report).valid ||
  hashCanonical(bundle.report) !== bundle.reportHash
)
  throw Error("RECORDED_REPORT_INVALID");
const ids = new Set(bundle.artifacts.map((a) => a.artifactId));
for (const a of bundle.artifacts) {
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(a.base64, "base64"))
    .digest("hex");
  if (a.sha256 !== "0x" + digest || a.artifactId !== "art_" + digest)
    throw Error("RECORDED_ARTIFACT_INVALID");
}
if (
  bundle.report.attempts.some((a) =>
    a.checks.some((c) => c.evidenceRefs.some((id) => !ids.has(id))),
  )
)
  throw Error("RECORDED_REFERENCE_MISSING");
if (
  bundle.report.executionMode !== "LIVE" ||
  bundle.report.result !== "SUCCEEDED" ||
  bundle.artifacts.length !== 16 ||
  bundle.networkCounts.provider !== 1 ||
  bundle.report.attempts.length !== 1 ||
  bundle.report.attempts[0].serviceId !== "svc_primary" ||
  bundle.report.acceptedFact.blockNumber !== "26144163" ||
  !bundle.report.attempts[0].checks.some(
    (c) =>
      c.ruleId === "client_dependency_policy" &&
      c.observed.startsWith("10 packages; 0 findings;"),
  )
)
  throw Error("FILM_CLAIMS_REQUIRE_REVIEW");
async function write(name, template, values, script) {
  if (/<\/script/i.test(script)) throw Error("INLINE_SCRIPT_TERMINATOR");
  const hash = crypto.createHash("sha256").update(script).digest("base64");
  const vars = { ...values, SCRIPT: script, SCRIPT_HASH: hash };
  const html = template.replace(/__([A-Z_]+)__/g, (_, key) => {
    if (!(key in vars)) throw Error("UNKNOWN_PLACEHOLDER_" + key);
    return vars[key];
  });
  await fs.writeFile(new URL("web/" + name, root), html);
  console.log(name + " · standalone · " + Buffer.byteLength(html) + " bytes");
}
await write(
  "demo.html",
  shell,
  {
    TITLE: "交互体验",
    MODE: "interactive",
    STYLE: style,
    HARBOR: harbor,
    OTHER: "demo-film.html",
    OTHER_LABEL: "观看操作短片",
  },
  '"use strict";\n(()=>{\n' +
    model.replace(/^export /gm, "") +
    "\n" +
    controller +
    "\n})();",
);
for (const [
  name,
  kind,
  title,
  content,
  duration,
  source,
  other,
  otherLabel,
] of [
  [
    "demo-film.html",
    "operation",
    "操作短片",
    operation,
    54,
    "实测记录回放",
    "promo.html",
    "观看项目宣传片",
  ],
  [
    "promo.html",
    "promo",
    "项目宣传片",
    promo,
    56,
    "项目原理与已验证成果",
    "demo-film.html",
    "观看操作短片",
  ],
]) {
  const data =
    kind === "operation"
      ? JSON.stringify(bundle).replace(/</g, "\\u003c")
      : "null";
  await write(
    name,
    cinemaShell,
    {
      TITLE: title,
      KIND: kind,
      STYLE: cinemaStyle,
      CONTENT: content.replace("__WUHAN__", harbor),
      DURATION: duration,
      SOURCE: source,
      OTHER: other,
      OTHER_LABEL: otherLabel,
    },
    '"use strict";\n(()=>{\nconst RECORDED_BUNDLE=' +
      data +
      ";\n" +
      player +
      "\n})();",
  );
}
