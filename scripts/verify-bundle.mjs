// Offline content verification in a separate process; does not establish truth/signature.
import fs from "node:fs";
import crypto from "node:crypto";
import { hashCanonical } from "../src/domain.js";
import { validateDefinition } from "../src/schema.js";
import { parseStrictJson } from "../src/strict-json.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: pnpm verify:bundle <downloaded.json>");
  process.exit(2);
}
if (fs.statSync(file).size > 64 * 1024 * 1024) throw Error("BUNDLE_TOO_LARGE");
const bundle = parseStrictJson(fs.readFileSync(file), 32, {
  maxBytes: 64 * 1024 * 1024,
  maxStringLength: 3 * 1024 * 1024,
});
const report = bundle.report,
  artifacts = bundle.artifacts;
const schema = validateDefinition("PublicReport", report).valid;
const integrity = schema && hashCanonical(report) === bundle.reportHash;
const validArtifacts =
  Array.isArray(artifacts) &&
  artifacts.length > 0 &&
  artifacts.every(
    (a) =>
      a &&
      typeof a.base64 === "string" &&
      "0x" +
        crypto
          .createHash("sha256")
          .update(Buffer.from(a.base64, "base64"))
          .digest("hex") ===
        a.sha256 &&
      a.artifactId === "art_" + a.sha256.slice(2),
  );
const ids = new Set((artifacts || []).filter(Boolean).map((a) => a.artifactId));
const referenced =
  schema &&
  report.attempts.every((a) =>
    a.checks.every((c) => c.evidenceRefs.every((id) => ids.has(id))),
  );
const result = {
  schema: schema ? "PASS" : "FAIL",
  integrity: integrity ? "PASS" : "FAIL",
  artifacts: validArtifacts ? "PASS" : "FAIL",
  referencesPresent: referenced ? "PASS" : "FAIL",
  signature: "NOT_CHECKED",
  chainAnchor: "NOT_CHECKED",
  assurance:
    "Content equality only; original RPC/OSV observations are not signed attestations.",
};
console.log(JSON.stringify(result, null, 2));
if (!schema || !integrity || !validArtifacts || !referenced)
  process.exitCode = 1;
