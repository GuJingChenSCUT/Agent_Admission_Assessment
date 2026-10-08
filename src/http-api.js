import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from './config.js';
import { makeTask, addEvent, hashCanonical, TERMINAL_STATUSES } from './domain.js';
import { approve, clarify, renewApproval, stop, fault } from './control.js';
import { TaskStore } from './store.js';
import { runTask, recoverInterrupted } from './runtime.js';
import { buildPublicReport } from './evidence.js';
import { validateDefinition } from './schema.js';
import { parseStrictJson } from './strict-json.js';
import { integrationInventory } from './integrations.js';
import { extractModelDraft } from './model-api.js';

const view = ({ owner, tickets, idempotency, ...task }) => task;
function shape(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k)) || required.some(k => !(k in body))) throw fault('INVALID_REQUEST_SCHEMA', 400);
}
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw fault('BODY_TOO_LARGE', 413); chunks.push(chunk); }
  try { return parseStrictJson(Buffer.concat(chunks).length ? Buffer.concat(chunks) : '{}'); } catch { throw fault('INVALID_JSON', 400); }
}
export function createApplication({ store = new TaskStore(), mode = config.executionMode, stepMs, modelAdapter = null, liveRuntime = null } = {}) {
  const sessions = new Map(), running = new Set();
  const modelRequests = new Set();
  const controllers = new Map();
  recoverInterrupted(store);
  const schedule = task => {
    if (running.has(task.taskId)) return;
    running.add(task.taskId);
    const controller = new AbortController(); controllers.set(task.taskId, controller);
    setImmediate(() => runTask(task, store, { stepMs, liveRuntime, signal: controller.signal }).catch(() => console.error('Worker persistence failure; inspect local database')).finally(() => { running.delete(task.taskId); controllers.delete(task.taskId); }));
  };
  for (const task of store.list()) if (task.status === 'QUEUED') schedule(task);
  const server = http.createServer(async (req, res) => {
    const json = (status, data, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw fault('HOST_NOT_ALLOWED', 403);
      if (req.headers.origin && req.headers.origin !== 'http://' + host) throw fault('CROSS_ORIGIN_DENIED', 403);
      const url = new URL(req.url, 'http://' + host), pathname = url.pathname;
      if (pathname === '/v1/session' && req.method === 'GET') {
        let sid = (req.headers.cookie || '').match(/(?:^|;\s*)aa_session=([a-f0-9]{48})(?:;|$)/)?.[1];
        if (!sid || !sessions.has(sid)) { sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, { owner: crypto.randomUUID(), csrf: crypto.randomBytes(24).toString('hex') }); }
        return json(200, { csrfToken: sessions.get(sid).csrf, executionMode: mode, authentication: 'LOCAL_BROWSER_SESSION', model: modelAdapter ? 'ADAPTER_CONFIGURED' : 'NOT_CONFIGURED' }, { 'set-cookie': 'aa_session=' + sid + '; HttpOnly; SameSite=Strict; Path=/' });
      }
      if (!pathname.startsWith('/v1/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw fault('METHOD_NOT_ALLOWED', 405);
        const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/prototype.html': ['prototype.html','text/html'], '/demo.html': ['demo.html','text/html'], '/demo-film.html': ['demo-film.html','text/html'], '/promo.html': ['promo.html','text/html'] };
        const entry = files[pathname]; if (!entry) throw fault('NOT_FOUND', 404);
        const bytes = await fs.readFile(new URL('../web/' + entry[0], import.meta.url));
        const demoScript = ['/demo.html', '/demo-film.html', '/promo.html'].includes(pathname) ? bytes.toString('utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1] : null;
        const scriptPolicy = demoScript ? "'sha256-" + crypto.createHash('sha256').update(demoScript).digest('base64') + "'" : pathname === '/prototype.html' ? "'unsafe-inline'" : '';
        res.writeHead(200, { 'content-type': entry[1] + '; charset=utf-8', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' " + scriptPolicy + "; style-src 'self' 'unsafe-inline'; connect-src " + (demoScript ? "'none'" : "'self'") + "; frame-ancestors 'none'; base-uri 'none'" });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      const sid = (req.headers.cookie || '').match(/(?:^|;\s*)aa_session=([a-f0-9]{48})(?:;|$)/)?.[1], session = sessions.get(sid);
      if (!session) throw fault('SESSION_REQUIRED', 401);
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) throw fault('CSRF_REQUIRED', 403);
      const owner = session.owner;
      if (pathname === '/v1/model' && req.method === 'GET') return json(200, { provider: 'PI', adapterConfigured: typeof modelAdapter?.extract === 'function', capability: 'DRAFT_ONLY', canExecuteTools: false });
      if (pathname === '/v1/model/drafts' && req.method === 'POST') {
        const body = await bodyOf(req); shape(body, ['text', 'allowFallback'], ['text']);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4096 || ('allowFallback' in body && typeof body.allowFallback !== 'boolean')) throw fault('INVALID_TASK_INPUT', 400);
        if (modelRequests.has(owner)) throw fault('MODEL_REQUEST_IN_PROGRESS', 429);
        modelRequests.add(owner);
        const abort = new AbortController();
        const disconnect = () => { if (!res.writableEnded) abort.abort(); };
        res.once('close', disconnect);
        try {
          const draft = await extractModelDraft({ adapter: modelAdapter, text: body.text, allowFallback: body.allowFallback ?? true, signal: abort.signal });
          return json(200, { provider: 'PI', draft, requiresApproval: true, executionStarted: false });
        } finally { res.off('close', disconnect); modelRequests.delete(owner); }
      }
      if (pathname === '/v1/integrations' && req.method === 'GET') return json(200, integrationInventory(mode, liveRuntime));
      if (pathname === '/v1/deployment' && req.method === 'GET') return json(200, { mode, database: 'SQLITE_WAL', model: modelAdapter ? 'ADAPTER_CONFIGURED' : 'NOT_CONFIGURED', parser: 'DETERMINISTIC_SCOPE_PARSER', rpc: liveRuntime?.ready ? 'CONFIGURED_CHECKED_PER_APPROVED_RUN' : 'NOT_CONFIGURED', dependencyScan: liveRuntime?.ready ? 'OSV_PER_LIVE_RUN' : 'ADAPTER_ONLY', registry: 'UNDEPLOYED', publicSigning: 'BLOCKED', ethereumIdentity: 'NOT_IMPLEMENTED', authentication: 'LOCAL_SESSION_ONLY', production: 'NOT_READY' });
      if (pathname === '/v1/tasks' && req.method === 'POST') {
        const body = await bodyOf(req); shape(body, ['text','allowFallback','scenario','executionMode'], ['text']);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4096 || ('allowFallback' in body && typeof body.allowFallback !== 'boolean')) throw fault('INVALID_TASK_INPUT', 400);
        if (body.executionMode !== undefined && !['LIVE','SAMPLE'].includes(body.executionMode)) throw fault('INVALID_EXECUTION_MODE', 400);
        // An explicit real request must never inherit the server's SAMPLE default.
        const requestedMode = body.executionMode ?? mode;
        if (requestedMode === 'LIVE' && !liveRuntime?.ready) throw fault('LIVE_RUNTIME_NOT_CONFIGURED', 503);
        const scenarios = ['normal','stale_primary','both_fail','reference_conflict','manifest_changed','optional_missing'];
        if ('scenario' in body && (requestedMode !== 'SAMPLE' || !scenarios.includes(body.scenario))) throw fault('INVALID_SCENARIO', 400);
        const task = makeTask({ owner, text: body.text, allowFallback: body.allowFallback ?? true, mode: requestedMode, scenario: body.scenario || 'normal' });
        if (task.draft.intentType === 'UNSUPPORTED') throw fault('UNSUPPORTED_SCOPE', 422);
        if (requestedMode === 'LIVE') liveRuntime.bindTask(task);
        renewApproval(task); addEvent(task, 'TASK_CREATED', task.spec ? '待批准的只读范围已生成。' : task.draft.clarification);
        store.put(task); return json(201, view(task));
      }
      if (pathname === '/v1/public/evidence/verify' && req.method === 'POST') {
        const body = await bodyOf(req); shape(body, ['report','reportHash'], ['report','reportHash']);
        const valid = validateDefinition('PublicReport', body.report).valid;
        return json(200, { schema: valid ? 'PASS' : 'FAIL', integrity: valid && hashCanonical(body.report) === body.reportHash ? 'PASS' : 'FAIL', signature: 'NOT_CHECKED', anchor: 'NOT_CHECKED', validity: valid && Date.parse(body.report.expiresAt) > Date.now() ? 'PASS' : 'FAIL', assurance: 'Content equality is not truth or registry confirmation.' });
      }
      const evidenceRoute = pathname.match(/^\/v1\/evidence\/([^/]+)\/(public-preview|publications)$/);
      if (evidenceRoute) {
        const task = store.list().find(t => t.owner === owner && t.report?.report.reportId === evidenceRoute[1]);
        if (!task) throw fault('EVIDENCE_NOT_FOUND', 404);
        if (evidenceRoute[2] === 'public-preview' && req.method === 'GET') return json(200, { ...task.report, publication: { status: 'NOT_REQUESTED', reason: 'SIGNER_NOT_CONFIGURED' } });
        if (evidenceRoute[2] === 'publications' && req.method === 'POST') throw fault('SIGNER_NOT_CONFIGURED', 503);
      }
      const match = pathname.match(/^\/v1\/tasks\/(tsk_[a-f0-9]+)(?:\/(clarifications|approve|stop|events|evidence|evidence-bundle|public-preview|artifacts)(?:\/(art_[a-f0-9]+))?)?$/);
      if (!match) throw fault('NOT_FOUND', 404);
      const [, taskId, action, artifactId] = match, task = store.get(taskId, owner);
      if (!task) throw fault('TASK_NOT_FOUND', 404);
      if (req.method === 'GET') {
        if (!action) return json(200, view(task));
        if (action === 'events') { const after = Number(url.searchParams.get('after') || 0); if (!Number.isSafeInteger(after) || after < 0) throw fault('INVALID_CURSOR', 400); return json(200, { taskId, events: task.events.filter(e => e.sequence > after) }); }
        if (action === 'artifacts') { const artifact = store.artifact(taskId, owner, artifactId); if (!artifact) throw fault('ARTIFACT_NOT_FOUND', 404); return json(200, artifact); }
        if (action === 'evidence-bundle') {
          if (!task.report) throw fault('EVIDENCE_NOT_READY', 409);
          const ids = [...new Set([...(task.artifactRefs || []), ...task.attempts.flatMap(a => a.checks.flatMap(c => c.evidenceRefs))])];
          return json(200, { ...task.report, artifactAssurance: 'Private original observations; SHA-256 checks byte equality, not authenticity.', artifacts: ids.map(id => store.artifact(taskId, owner, id)), networkCounts: task.networkCounts || null });
        }
        if (['evidence','public-preview'].includes(action)) { if (!task.report) throw fault('EVIDENCE_NOT_READY', 409); return json(200, task.report); }
      }
      if (req.method !== 'POST') throw fault('METHOD_NOT_ALLOWED', 405);
      const body = await bodyOf(req);
      if (action === 'approve') {
        shape(body, ['revision','specHash','approvalNonce'], ['revision','specHash','approvalNonce']);
        const updated = store.mutate(taskId, owner, t => {
          if (t.status === 'AWAITING_APPROVAL' && running.size >= 2) throw fault('RUN_CAPACITY_REACHED', 429);
          return approve(t, body, req.headers['idempotency-key']);
        });
        if (updated.result) schedule(updated.task); return json(202, view(updated.task));
      }
      if (action === 'clarifications') { shape(body, ['revision','text'], ['revision','text']); if (typeof body.text !== 'string' || body.text.length > 4096) throw fault('INVALID_CLARIFICATION', 400); return json(200, view(store.mutate(taskId, owner, t => clarify(t, body)).task)); }
      if (action === 'stop') {
        shape(body, []); const updated = store.mutate(taskId, owner, t => { stop(t); if (t.status === 'CANCELLED' && t.spec) t.report = buildPublicReport(t); });
        controllers.get(taskId)?.abort();
        if (updated.task.status === 'STOP_REQUESTED' && !running.has(taskId)) schedule(updated.task);
        return json(TERMINAL_STATUSES.includes(updated.task.status) ? 200 : 202, view(updated.task));
      }
      throw fault('NOT_FOUND', 404);
    } catch (error) { return json(error.status || 500, { error: error.status ? error.message : 'INTERNAL_ERROR' }); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return { server, store, running, abortAll: () => { for (const controller of controllers.values()) controller.abort(); } };
}
