import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';
import { addEvent, makeTask, parseIntent, taskSpecFromDraft, transition } from './domain.js';
import { TaskStore } from './store.js';
import { runTask } from './worker.js';

const store = new TaskStore();
const webDir = path.resolve('web');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const ownerOf = req => req.headers['x-owner']?.toString() || 'dev-owner';
const readBody = async req => { let total = 0; const chunks = []; for await (const chunk of req) { total += chunk.length; if (total > config.maxBodyBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }); chunks.push(chunk); } if (!total) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); } };
const taskView = task => ({ ...task, idempotency: undefined, owner: undefined });
const route = (pathname, method) => { const match = pathname.match(/^\/v1\/tasks\/([^/]+)(?:\/(clarifications|approve|stop|events|evidence|public-preview))?$/); return match ? { taskId: match[1], action: match[2] || 'task' } : null; };

async function handleApi(req, res, pathname) {
  const owner = ownerOf(req); const match = route(pathname, req.method); if (!match && pathname === '/v1/tasks' && req.method === 'POST') { const body = await readBody(req); const task = makeTask({ owner, text: body.text, allowFallback: body.allowFallback !== false, mode: body.mode || config.executionMode, scenario: body.scenario || 'normal' }); addEvent(task, 'TASK_CREATED', task.spec ? '已生成待批准的任务范围。' : task.draft.clarification); await store.put(task); return json(res, 201, taskView(task)); }
  if (!match) return json(res, 404, { error: 'NOT_FOUND' }); const task = await store.get(match.taskId, owner); if (!task) return json(res, 404, { error: 'TASK_NOT_FOUND' });
  if (req.method === 'GET' && match.action === 'task') return json(res, 200, taskView(task));
  if (req.method === 'GET' && match.action === 'events') return json(res, 200, { taskId: task.taskId, events: task.events });
  if (req.method === 'GET' && match.action === 'evidence') return task.report ? json(res, 200, task.report) : json(res, 409, { error: 'EVIDENCE_NOT_READY' });
  if (req.method === 'GET' && match.action === 'public-preview') return task.report ? json(res, 200, { report: task.report, reportHash: task.report.reportHash, hashAlgorithm: task.report.hashAlgorithm, publication: { status: 'NOT_REQUESTED' } }) : json(res, 409, { error: 'EVIDENCE_NOT_READY' });
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const body = await readBody(req);
  if (match.action === 'clarifications') { if (task.status !== 'NEEDS_INPUT') return json(res, 409, { error: 'TASK_NOT_WAITING_FOR_CLARIFICATION' }); const parsed = parseIntent(body.text || body.address || '', task.draft.allowFallback); task.revision += 1; task.draft = parsed; task.spec = taskSpecFromDraft(parsed); task.specHash = task.spec ? (await import('./domain.js')).hashCanonical(task.spec) : null; task.status = task.spec ? 'AWAITING_APPROVAL' : 'NEEDS_INPUT'; task.phase = 'PLAN'; addEvent(task, 'CLARIFICATION_APPLIED', parsed.clarification || '范围已更新。'); await store.update(task); return json(res, 200, taskView(task)); }
  if (match.action === 'approve') { if (task.status !== 'AWAITING_APPROVAL' || !task.spec) return json(res, 409, { error: 'TASK_NOT_APPROVABLE' }); transition(task, 'QUEUED', 'PLAN'); task.approvedAt = new Date().toISOString(); task.runId = `run_${task.taskId}`; addEvent(task, 'TASK_APPROVED', '用户批准当前 revision、范围、候选和预算。'); await store.update(task); setImmediate(() => runTask(task, store).catch(error => { task.status = 'QUARANTINED'; task.phase = 'COMPLETE'; addEvent(task, 'WORKER_ERROR', '运行器异常，任务进入隔离。', { code: error.message }); store.update(task); })); return json(res, 202, taskView(task)); }
  if (match.action === 'stop') { if (['SUCCEEDED', 'FAILED', 'QUARANTINED', 'CANCELLED'].includes(task.status)) return json(res, 200, taskView(task)); task.stopRequestedAt = new Date().toISOString(); task.stopEpoch += 1; if (['NEEDS_INPUT', 'AWAITING_APPROVAL'].includes(task.status)) { transition(task, 'CANCELLED', 'COMPLETE'); addEvent(task, 'TASK_CANCELLED', '草稿已取消，没有外部调用。'); } else if (task.status === 'QUEUED' || task.status === 'RUNNING') { transition(task, 'STOP_REQUESTED', 'STOPPING'); addEvent(task, 'STOP_ACKNOWLEDGED', '停止请求已持久化；正在收尾。'); } await store.update(task); return json(res, 202, taskView(task)); }
  return json(res, 404, { error: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/v1/')) return await handleApi(req, res, url.pathname); if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const safe = path.resolve(webDir, file); if (!safe.startsWith(webDir)) return json(res, 400, { error: 'INVALID_PATH' }); const data = await fs.readFile(safe); const type = safe.endsWith('.html') ? 'text/html; charset=utf-8' : safe.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8'; res.writeHead(200, { 'content-type': type }); if (req.method === 'GET') res.end(data); else res.end(); } catch (error) { json(res, error.status || 500, { error: error.message || 'INTERNAL_ERROR' }); }
});

await ensureDataDir(); await store.ready; server.listen(config.port, () => console.log(`Agent Admission Assessment listening on http://localhost:${config.port} (${config.executionMode})`));
