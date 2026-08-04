import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhunxing-api-'));
process.env.INFO_SOURCE_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.REDFOX_API_KEY = 'test-only-key';

const { default: app } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');
const server = await new Promise(resolve => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('/api/config exposes frontend provider availability', async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.providers.youtube.available, true);
  assert.equal(config.providers.douyin.available, true);
  assert.equal(config.providers.wechat.available, true);
  assert.equal(config.providers.xiaohongshu.available, false);
  assert.match(config.providers.xiaohongshu.reason, /接口契约/);
});

test('/api/fetch/status flattens latest task state', async () => {
  const queued = await fetch(`${baseUrl}/api/fetch`, { method: 'POST' });
  assert.equal(queued.status, 202);
  await new Promise(resolve => setImmediate(resolve));

  const response = await fetch(`${baseUrl}/api/fetch/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(typeof status.status, 'string');
  assert.equal(typeof status.total, 'number');
  assert.equal(typeof status.completed, 'number');
  assert.equal(typeof status.succeeded, 'number');
  assert.equal(typeof status.failed, 'number');
  assert.ok(Array.isArray(status.results));
  assert.ok(Array.isArray(status.tasks));
  assert.equal(status.task_id, status.tasks[0].id);
});

test('POST /api/bloggers 持久化 avatar_url 与 channel_account', async () => {
  const response = await fetch(`${baseUrl}/api/bloggers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '测试频道', channel_type: 'youtube', channel_id: 'UC_TEST_FAKE_12345',
      avatar_url: 'https://example.com/avatar.jpg', channel_account: 'test_account_123',
    }),
  });
  assert.equal(response.status, 201);
  const blogger = await response.json();
  assert.equal(blogger.avatar_url, 'https://example.com/avatar.jpg');
  assert.equal(blogger.channel_account, 'test_account_123');
});

test('POST /api/bloggers 按 channel_account 查重返回 already_exists', async () => {
  const response = await fetch(`${baseUrl}/api/bloggers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '另一个名字', channel_type: 'youtube', channel_id: 'UC_ANOTHER_999',
      channel_account: 'test_account_123',
    }),
  });
  assert.equal(response.status, 200);
  const blogger = await response.json();
  assert.equal(blogger.already_exists, true);
  assert.equal(blogger.channel_account, 'test_account_123');
});

test('POST /api/fetch/search 缺 keyword 返回 400', async () => {
  const response = await fetch(`${baseUrl}/api/fetch/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_type: 'wechat' }),
  });
  assert.equal(response.status, 400);
});

test('POST /api/fetch/search 不支持的渠道返回错误', async () => {
  const response = await fetch(`${baseUrl}/api/fetch/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_type: 'youtube', keyword: 'test' }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /暂不支持账号搜索/);
});
