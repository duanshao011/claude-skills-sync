import test from 'node:test';
import assert from 'node:assert/strict';
import { FetchManager } from '../src/fetch-manager.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('coalesces duplicate active blogger tasks', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const manager = new FetchManager({ fetchAll: async () => [], fetchOne: async () => pending });
  const first = manager.enqueueBlogger({ id: 7 });
  const second = manager.enqueueBlogger({ id: 7 });
  assert.equal(second.id, first.id);
  assert.equal(first.coalesced_requests, 1);
  release({ success: true });
  await tick();
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.progress, {
    total: 1, completed: 1, succeeded: 1, failed: 0, current_blogger_id: null,
  });
});

test('reports all-task progress', async () => {
  const manager = new FetchManager({
    fetchAll: async ({ onProgress }) => {
      onProgress({ total: 2, completed: 1, succeeded: 1, failed: 0, current_blogger_id: 2 });
      onProgress({ total: 2, completed: 2, succeeded: 1, failed: 1, current_blogger_id: null });
      return [];
    },
    fetchOne: async () => ({}),
  });
  const task = manager.enqueueAll();
  await tick();
  assert.equal(task.status, 'completed');
  assert.equal(task.progress.completed, 2);
  assert.equal(task.progress.failed, 1);
});
