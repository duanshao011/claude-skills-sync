import { randomUUID } from 'node:crypto';
import { serializeProviderError } from './providers/errors.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);

export class FetchManager {
  constructor({ fetchAll, fetchOne, maxHistory = 100 }) {
    this.fetchAll = fetchAll;
    this.fetchOne = fetchOne;
    this.maxHistory = maxHistory;
    this.tasks = new Map();
    this.activeTasks = new Map();
  }

  enqueueAll() {
    return this.#enqueue('all', null, ({ onProgress }) => this.fetchAll({ onProgress }));
  }

  enqueueBlogger(blogger) {
    return this.#enqueue('blogger', blogger.id, async ({ onProgress }) => {
      onProgress({ total: 1, completed: 0, succeeded: 0, failed: 0, current_blogger_id: blogger.id });
      try {
        const result = await this.fetchOne(blogger);
        onProgress({ total: 1, completed: 1, succeeded: 1, failed: 0, current_blogger_id: null });
        return result;
      } catch (error) {
        onProgress({ total: 1, completed: 1, succeeded: 0, failed: 1, current_blogger_id: null });
        throw error;
      }
    });
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  list() {
    return [...this.tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  #enqueue(scope, bloggerId, execute) {
    const key = scope === 'all' ? 'all' : `blogger:${bloggerId}`;
    const active = this.activeTasks.get(key);
    if (active && ACTIVE_STATUSES.has(active.status)) {
      active.coalesced_requests++;
      return active;
    }

    const task = {
      id: randomUUID(),
      scope,
      blogger_id: bloggerId,
      status: 'queued',
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      coalesced_requests: 0,
      progress: {
        total: scope === 'blogger' ? 1 : 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        current_blogger_id: null,
      },
      result: null,
      error: null,
    };
    this.tasks.set(task.id, task);
    this.activeTasks.set(key, task);
    this.#trim();

    queueMicrotask(async () => {
      task.status = 'running';
      task.started_at = new Date().toISOString();
      const onProgress = progress => {
        task.progress = { ...task.progress, ...progress };
      };
      try {
        task.result = await execute({ onProgress });
        task.status = 'completed';
      } catch (error) {
        task.error = serializeProviderError(error);
        task.status = 'failed';
      } finally {
        task.completed_at = new Date().toISOString();
        this.activeTasks.delete(key);
      }
    });

    return task;
  }

  #trim() {
    if (this.tasks.size <= this.maxHistory) return;
    for (const [id, task] of this.tasks) {
      if (ACTIVE_STATUSES.has(task.status)) continue;
      this.tasks.delete(id);
      if (this.tasks.size <= this.maxHistory) break;
    }
  }
}
