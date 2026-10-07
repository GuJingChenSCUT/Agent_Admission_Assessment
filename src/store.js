import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDataDir, config } from './config.js';

export class TaskStore {
  constructor(file = path.join(config.dataDir, 'tasks.json')) { this.file = file; this.tasks = new Map(); this.flushChain = Promise.resolve(); this.ready = this.load(); }
  async load() { await ensureDataDir(); try { const value = JSON.parse(await fs.readFile(this.file, 'utf8')); for (const task of value) this.tasks.set(task.taskId, task); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  async flush() {
    this.flushChain = this.flushChain.catch(() => undefined).then(async () => {
      await ensureDataDir();
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify([...this.tasks.values()], null, 2), 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.flushChain;
  }
  async put(task) { await this.ready; this.tasks.set(task.taskId, task); await this.flush(); return task; }
  async get(taskId, owner) { await this.ready; const task = this.tasks.get(taskId); if (!task || task.owner !== owner) return null; return task; }
  async update(task) { return this.put(task); }
}
