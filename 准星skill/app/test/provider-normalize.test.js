import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticle, normalizeFetchResult } from '../src/providers/normalize.js';
import { createRedfoxClient } from '../src/clients/redfox.js';

const originalKey = process.env.REDFOX_API_KEY;

test.after(() => {
  if (originalKey === undefined) delete process.env.REDFOX_API_KEY;
  else process.env.REDFOX_API_KEY = originalKey;
});

test('normalizeFetchResult accepts camelCase provider fields', () => {
  const result = normalizeFetchResult({ articles: [{ title: 'A', url: 'https://example.test/a', externalId: 'one' }], cursor: 3 });
  assert.equal(result.articles[0].external_id, 'one');
  assert.equal(result.cursor, '3');
});

test('normalizeArticle rejects entries without stable identity', () => {
  assert.throws(() => normalizeArticle({ title: 'A' }), /url or externalId/);
});

test('redfox client reports missing configuration without network call', async () => {
  delete process.env.REDFOX_API_KEY;
  await assert.rejects(
    createRedfoxClient().queryDouyinUserWithWorks({ accountId: 'test' }),
    error => error.code === 'PROVIDER_NOT_CONFIGURED'
  );
});
