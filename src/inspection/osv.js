/** Static npm-lock inspector. request(path, body) must use a configured, bounded
 * egress adapter. This module never installs a package or executes lockfile scripts. */
export function packagesFromLock(lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages) throw new Error('UNSUPPORTED_LOCKFILE');
  const packages = new Map();
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    const name = entry.name || location.split('node_modules/').at(-1);
    if (entry.link || typeof name !== 'string' || !/^(@[^/]+\/)?[^/]+$/.test(name) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(entry.version || '')) throw new Error('UNRESOLVED_PACKAGE_VERSION');
    packages.set(name + '@' + entry.version, { name, version: entry.version, ecosystem: 'npm' });
  }
  if (!packages.size) throw new Error('NO_LOCKFILE_PACKAGES');
  return [...packages.values()];
}
export async function inspectLockfile(lock, request, maxRequests = 20) {
  const observations = [], findings = []; let requests = 0;
  async function call(path, body) {
    if (++requests > maxRequests) throw new Error('ADVISORY_BUDGET_EXHAUSTED');
    const response = await request(path, body);
    observations.push({ path, fetchedAt: new Date().toISOString(), response });
    return response;
  }
  try {
    for (const pkg of packagesFromLock(lock)) {
      let token; const visited = new Set();
      do {
        const result = await call('/v1/query', { package: { name: pkg.name, ecosystem: 'npm' }, version: pkg.version, ...(token ? { page_token: token } : {}) });
        if (!result || typeof result !== 'object' || (result.vulns !== undefined && !Array.isArray(result.vulns))) throw new Error('OSV_RESPONSE_INVALID');
        for (const partial of result.vulns || []) {
          if (typeof partial.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(partial.id)) throw new Error('OSV_ID_INVALID');
          const full = await call('/v1/vulns/' + encodeURIComponent(partial.id));
          if (full.id !== partial.id || !full.modified || !Array.isArray(full.affected)) throw new Error('OSV_RECORD_INCOMPLETE');
          if (!full.withdrawn) findings.push({ package: pkg, id: full.id, aliases: full.aliases || [], modified: full.modified, source: 'OSV' });
        }
        token = result.next_page_token;
        if (token && (typeof token !== 'string' || visited.has(token))) throw new Error('OSV_PAGINATION_INVALID');
        if (token) visited.add(token);
      } while (token);
    }
    return { status: findings.length ? 'FAIL' : 'PASS', reason: findings.length ? 'KNOWN_ADVISORY_FOUND' : 'NO_KNOWN_ADVISORY_AT_FETCH', findings, observations, requests, deploymentBinding: 'NOT_VERIFIED' };
  } catch (error) {
    return { status: 'INCONCLUSIVE', reason: /^[A-Z_]+$/.test(error.message) ? error.message : 'ADVISORY_SOURCE_UNAVAILABLE', findings, observations, requests, deploymentBinding: 'NOT_VERIFIED' };
  }
}
