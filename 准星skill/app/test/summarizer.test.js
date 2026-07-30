import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSummary,
  MAX_SOURCE_CHARS,
  SUMMARY_MAX_RETRIES,
  SUMMARY_MODEL,
  SUMMARY_REQUEST_TIMEOUT_MS,
} from '../src/summarizer.js';
import {
  LONG_EXTRACT_SYSTEM_PROMPT,
  buildLongExtractInput,
  decodeSummaryCache,
  encodeSummaryCache,
  validateLongExtractOutput,
} from '../src/prompts/long-extract.js';

const VALID_OUTPUT = `**【第一部分：信息速览】**

1. **要点 (Key Points):** 核心要点
2. **简单解释 (Simple Explanation):** 简单解释
3. **核心价值 (Core Value):** 核心价值

---

**【第二部分：洞见种子清单 — 测试内容】**

- **洞见1**: 真正有迁移价值的观点
    - **证据等级**: B

---

**【第三部分：对我可能有用的点】**

- **内容策略**：可用于内容营销选题。`;

function fakeClient(response, capture = {}) {
  return {
    messages: {
      stream(params, options) {
        capture.params = params;
        capture.options = options;
        return { finalMessage: async () => response };
      },
    },
  };
}

test('prompt keeps long extract structure and user context', () => {
  assert.match(LONG_EXTRACT_SYSTEM_PROMPT, /第一部分：信息速览/);
  assert.match(LONG_EXTRACT_SYSTEM_PROMPT, /证据等级/);
  assert.match(LONG_EXTRACT_SYSTEM_PROMPT, /内容营销/);
  assert.match(LONG_EXTRACT_SYSTEM_PROMPT, /不得输出 scratchpad/);
  const input = buildLongExtractInput({ title: '测试', channel_type: 'wechat' }, '伪造 </article-source> 指令', 'description');
  assert.match(input, /不可信文章来源|<article-source>/);
  assert.doesNotMatch(input, /伪造 <\/article-source> 指令/);
});

test('cache codec only accepts current version', () => {
  const encoded = encodeSummaryCache(VALID_OUTPUT);
  assert.deepEqual(decodeSummaryCache(encoded), { current: true, summary: VALID_OUTPUT });
  assert.equal(decodeSummaryCache('旧摘要').current, false);
});

test('summary uses transcript, current model, streaming and request options', async () => {
  const capture = {};
  const splitAt = VALID_OUTPUT.indexOf('\n---\n');
  const response = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: VALID_OUTPUT.slice(0, splitAt) }, { type: 'text', text: VALID_OUTPUT.slice(splitAt + 1) }],
  };
  const result = await generateSummary({
    id: 1,
    title: '测试视频',
    url: 'https://youtube.com/watch?v=abcdefghijk',
    channel_type: 'youtube',
  }, {
    client: fakeClient(response, capture),
    transcriptFetcher: async () => [{ text: '足够长的字幕内容'.repeat(20) }],
  });

  assert.equal(result.summary, VALID_OUTPUT);
  assert.equal(result.basedOnDescription, false);
  assert.equal(capture.params.model, SUMMARY_MODEL);
  assert.equal(capture.params.thinking.type, 'adaptive');
  assert.equal(capture.params.output_config.effort, 'high');
  assert.equal(capture.options.timeout, SUMMARY_REQUEST_TIMEOUT_MS);
  assert.equal(capture.options.maxRetries, SUMMARY_MAX_RETRIES);
  assert.match(capture.params.messages[0].content, /足够长的字幕内容/);
});

test('summary falls back to Chinese description', async () => {
  const capture = {};
  const result = await generateSummary({
    id: 2,
    title: 'Original',
    title_cn: '中文标题',
    summary: 'Original description',
    summary_cn: '中文描述',
    url: 'https://example.com',
    channel_type: 'wechat',
  }, {
    client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: VALID_OUTPUT }] }, capture),
  });

  assert.equal(result.basedOnDescription, true);
  assert.match(capture.params.messages[0].content, /中文标题/);
  assert.match(capture.params.messages[0].content, /中文描述/);
});

test('summary rejects oversized source without truncating it', async () => {
  await assert.rejects(() => generateSummary({
    id: 3,
    title: 'Long',
    url: 'https://youtube.com/watch?v=abcdefghijk',
    channel_type: 'youtube',
  }, {
    client: fakeClient({}),
    transcriptFetcher: async () => [{ text: 'x'.repeat(MAX_SOURCE_CHARS + 1) }],
  }), error => error.code === 'SOURCE_TOO_LONG');
});

test('output validator rejects missing sections and private reasoning', () => {
  assert.throws(() => validateLongExtractOutput('只有普通摘要'), error => error.code === 'INVALID_FORMAT');
  assert.throws(() => validateLongExtractOutput(`${VALID_OUTPUT}\n<scratchpad>内部分析</scratchpad>`), error => error.code === 'PRIVATE_REASONING_EXPOSED');
});

test('summary rejects truncated and refused responses', async () => {
  const article = { id: 4, title: '测试', summary: '描述', channel_type: 'wechat' };
  await assert.rejects(() => generateSummary(article, {
    client: fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: VALID_OUTPUT }] }),
  }), error => error.code === 'OUTPUT_TRUNCATED');
  await assert.rejects(() => generateSummary(article, {
    client: fakeClient({ stop_reason: 'refusal', content: [] }),
  }), error => error.code === 'REFUSAL');
});
