import fs from "node:fs";
import { parse } from "yaml";
import { hashCanonical } from "../domain.js";
import { failure } from "../net.js";

export function productionPackages(lock, manifest) {
  if (
    String(lock?.lockfileVersion) !== "9.0" ||
    !lock.snapshots ||
    !lock.packages ||
    !lock.importers?.["."]
  )
    throw failure("UNSUPPORTED_LOCKFILE");
  const root = lock.importers["."].dependencies || {},
    expected = manifest.dependencies || {};
  if (
    Object.keys(root).sort().join() !== Object.keys(expected).sort().join() ||
    Object.entries(root).some(
      ([name, entry]) => entry.specifier !== expected[name],
    )
  )
    throw failure("LOCKFILE_MANIFEST_MISMATCH");
  const visited = new Set(),
    packages = new Map();
  function visit(name, resolved) {
    if (
      !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
      typeof resolved !== "string"
    )
      throw failure("UNRESOLVED_PACKAGE_VERSION");
    const version = resolved.split("(")[0],
      key = name + "@" + resolved,
      packageKey = name + "@" + version;
    if (
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) ||
      !lock.snapshots[key] ||
      !lock.packages[packageKey]?.resolution?.integrity
    )
      throw failure("UNRESOLVED_PACKAGE_VERSION");
    if (visited.has(key)) return;
    visited.add(key);
    if (visited.size > 200) throw failure("DEPENDENCY_BUDGET_EXHAUSTED");
    packages.set(packageKey, { name, version, ecosystem: "npm" });
    const snapshot = lock.snapshots[key];
    for (const [child, resolvedChild] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    }))
      visit(child, resolvedChild);
  }
  for (const [name, entry] of Object.entries(root)) visit(name, entry.version);
  if (!packages.size) throw failure("NO_LOCKFILE_PACKAGES");
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function dependencySnapshot(root = new URL("../../", import.meta.url)) {
  const lockText = fs.readFileSync(new URL("pnpm-lock.yaml", root), "utf8");
  const manifestText = fs.readFileSync(new URL("package.json", root), "utf8");
  if (Buffer.byteLength(lockText) > 2 * 1024 * 1024)
    throw failure("LOCKFILE_TOO_LARGE");
  const packages = productionPackages(
    parse(lockText, { maxAliasCount: 0 }),
    JSON.parse(manifestText),
  );
  return {
    digest: hashCanonical({ lockText, manifestText }),
    packages,
    inputs: { lockText, manifestText },
  };
}

// Batch lookup, then fetch complete records for hits. No cached PASS across runs.
export async function inspectPackages(packages, request) {
  let requests = 0;
  const findings = [];
  const call = async (path, body) => {
    if (++requests > 20) throw failure("ADVISORY_BUDGET_EXHAUSTED");
    return request(path, body);
  };
  try {
    const queries = packages.map((p) => ({
      package: { name: p.name, ecosystem: "npm" },
      version: p.version,
    }));
    const batch = await call("/v1/querybatch", { queries });
    if (
      !Array.isArray(batch?.results) ||
      batch.results.length !== packages.length
    )
      throw failure("OSV_RESPONSE_INVALID");
    for (let i = 0; i < packages.length; i++) {
      let result = batch.results[i];
      const seen = new Set();
      while (true) {
        if (
          !result ||
          typeof result !== "object" ||
          Array.isArray(result) ||
          (result.vulns !== undefined && !Array.isArray(result.vulns))
        )
          throw failure("OSV_RESPONSE_INVALID");
        for (const partial of result.vulns || []) {
          if (
            typeof partial?.id !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,160}$/.test(partial.id)
          )
            throw failure("OSV_ID_INVALID");
          const full = await call(
            "/v1/vulns/" + encodeURIComponent(partial.id),
          );
          if (
            full?.id !== partial.id ||
            !full.modified ||
            !Array.isArray(full.affected)
          )
            throw failure("OSV_RECORD_INCOMPLETE");
          if (!full.withdrawn)
            findings.push({
              package: packages[i],
              id: full.id,
              modified: full.modified,
            });
        }
        if (
          result.next_page_token === undefined ||
          result.next_page_token === ""
        )
          break;
        const token = result.next_page_token;
        if (typeof token !== "string" || token.length > 2048 || seen.has(token))
          throw failure("OSV_PAGINATION_INVALID");
        seen.add(token);
        result = await call("/v1/query", { ...queries[i], page_token: token });
      }
    }
    return {
      status: findings.length ? "FAIL" : "PASS",
      reason: findings.length
        ? "KNOWN_ADVISORY_FOUND"
        : "NO_KNOWN_ADVISORY_AT_FETCH",
      findings,
      requests,
    };
  } catch (e) {
    return {
      status: "INCONCLUSIVE",
      reason: e.code || "ADVISORY_SOURCE_UNAVAILABLE",
      findings,
      requests,
    };
  }
}
