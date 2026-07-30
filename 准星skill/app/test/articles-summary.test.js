import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createArticlesRouter } from '../src/routes/articles.js';
import { encodeSummaryCache } from '../src/prompts/long-extract.js';

const SUMMARY = `**【第一部分：信息速览】**
1. **要点 (Key Points):** 要点
2. **简单解释 (Simple Explanation):** 解释
3. **核心价值 (Core Value):** 价值
**【第二部分：洞见种子清单 — 测试】**
- **洞见1**: 洞见
  - **证据等级**: B
**【第三部分：对我可能有用的点】**
- **内容策略**：用于选题。`;

function createDatabase(aiSummary = null) {
  const article = { id: 1, title: '测试文章', summary: '描述', channel_type: 'wechat', ai_summary: aiSummary };
  const writes = [];
  return {
    article,
    writes,
    get(sql) {
      if (sql.includes('FROM articles a')) return { ...article };
      if (sql.includes('SELECT * FROM articles')) return { ...article };
      return null;
    },
    all() { return []; },
    run(sql, params = []) {
      writes.push({ sql, params });
      if (sql.includes('SET ai_summary')) article.ai_summary = params[0];
      return { changes: 1 };
    },
    save() {},
  };
}

async function startServer(database, generator, available = () => true) {
  const app = express();
  app.use(express.json());
  app.use('/api/articles', createArticlesRouter({ db: database, generateSummary: generator, isAvailable: available }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('current cache returns without calling generator or exposing prefix', async t => {
  const database = createDatabase(encodeSummaryCache(SUMMARY));
  let calls = 0;
  const instance = await startServer(database, async () => { calls++; });
  t.after(instance.close);

  const response = await fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.summary, SUMMARY);
  assert.equal(data.cached, true);
  assert.equal(calls, 0);
});

test('legacy cache regenerates and description warning is persisted', async t => {
  const database = createDatabase('旧格式摘要');
  const instance = await startServer(database, async () => ({ summary: SUMMARY, basedOnDescription: true }));
  t.after(instance.close);

  const response = await fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  const data = await response.json();
  assert.equal(data.cached, false);
  assert.match(data.summary, /^> 内容完整度提示/);
  assert.match(database.article.ai_summary, /^@@long-extract:v1@@/);
  assert.doesNotMatch(data.summary, /@@long-extract/);
});

test('concurrent requests share one generation', async t => {
  const database = createDatabase();
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const instance = await startServer(database, async () => {
    calls++;
    await wait;
    return { summary: SUMMARY, basedOnDescription: false };
  });
  t.after(instance.close);

  const first = fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  const second = fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  await new Promise(resolve => setImmediate(resolve));
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(calls, 1);
});

test('failed generation does not overwrite cache and can retry', async t => {
  const database = createDatabase('旧格式摘要');
  let calls = 0;
  const instance = await startServer(database, async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('secret upstream detail'), { code: 'RATE_LIMIT' });
    return { summary: SUMMARY, basedOnDescription: false };
  });
  t.after(instance.close);

  const failed = await fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  assert.equal(failed.status, 429);
  assert.deepEqual(await failed.json(), { error: '摘要请求较多，请稍后重试' });
  assert.equal(database.article.ai_summary, '旧格式摘要');

  const retried = await fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  assert.equal(retried.status, 200);
  assert.equal(calls, 2);
});

test('unconfigured summary service returns stable error', async t => {
  const database = createDatabase();
  const instance = await startServer(database, async () => ({ summary: SUMMARY }), () => false);
  t.after(instance.close);

  const response = await fetch(`${instance.baseUrl}/api/articles/1/summary`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: '摘要服务尚未配置' });
});
