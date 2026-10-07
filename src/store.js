import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Single-node durable kernel: every control change and ticket consumption is a short
// SQLite transaction. Network and model calls stay outside mutate().
export class TaskStore {
  constructor(file = path.join(config.dataDir, 'admission.sqlite')) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, digest TEXT NOT NULL, bytes BLOB NOT NULL);`);
    this.ready = Promise.resolve();
  }
  put(task) { this.db.prepare('INSERT INTO tasks(id,owner,body) VALUES(?,?,?)').run(task.taskId, task.owner, JSON.stringify(task)); return structuredClone(task); }
  get(taskId, owner) { const row = this.db.prepare('SELECT body FROM tasks WHERE id=? AND owner=?').get(taskId, owner); return row ? JSON.parse(row.body) : null; }
  list() { return this.db.prepare('SELECT body FROM tasks').all().map(row => JSON.parse(row.body)); }
  update(task) { this.db.prepare('UPDATE tasks SET body=? WHERE id=? AND owner=?').run(JSON.stringify(task), task.taskId, task.owner); return structuredClone(task); }
  mutate(taskId, owner, change) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.get(taskId, owner);
      if (!task) throw Object.assign(new Error('TASK_NOT_FOUND'), { status: 404 });
      const result = change(task);
      if (result?.then) throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
      this.db.prepare('UPDATE tasks SET body=? WHERE id=? AND owner=?').run(JSON.stringify(task), taskId, owner);
      this.db.exec('COMMIT'); return { task, result };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveArtifact(taskId, bytes, digest) {
    const id = `art_${digest.slice(2)}`;
    this.db.prepare('INSERT OR IGNORE INTO artifacts(id,task_id,digest,bytes) VALUES(?,?,?,?)').run(`${taskId}:${id}`, taskId, digest, Buffer.from(bytes));
    return id;
  }
  artifact(taskId, owner, id) { if (!this.get(taskId, owner)) return null; const row = this.db.prepare('SELECT digest,bytes FROM artifacts WHERE id=? AND task_id=?').get(`${taskId}:${id}`, taskId); return row ? { artifactId: id, sha256: row.digest, base64: Buffer.from(row.bytes).toString('base64') } : null; }
  close() { this.db.close(); }
}
