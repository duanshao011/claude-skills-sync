import { fetchTranscript } from 'youtube-transcript';
import { fetchArticleContent } from './fetchers/wechat.js';
import db from './db.js';
import {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryInput,
  validateSummaryOutput,
} from './prompts/summary.js';

export const SUMMARY_MODEL = 'deepseek-v4-flash';
export const MAX_SOURCE_CHARS = 300_000;
export const SUMMARY_REQUEST_TIMEOUT_MS = 90_000;
export const SUMMARY_MAX_RETRIES = 1;

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export class SummaryGenerationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SummaryGenerationError';
    this.code = code;
    this.requestId = options.requestId || null;
  }
}

// 正文少于这个长度就认为拿到的只是标题或零星片段，不足以支撑总结。
// 之前的阈值是 50，导致 89 字的纯图片文章也被拿去生成了四段分析。
const MIN_CONTENT_CHARS = 200;

const INSUFFICIENT_SOURCE_MESSAGE = [
  '## 无法生成摘要',
  '',
  '**内容不全，无法总结。**',
  '',
  '这篇文章的正文没有抓取到，目前只有标题和一句话来源描述。常见原因：',
  '',
  '- 文章主体是图片（海报、长图、截图），数据源只能提取文字，图片内容取不到',
  '- 数据源尚未收录这篇文章的正文',
  '- 正文接口临时失败，可以稍后重试',
  '',
  '摘要必须基于原文生成，信息不足时不做推测。请点击「查看原文」阅读。',
].join('\n');

export function isAvailable() {
  return !!process.env.DEEPSEEK_API_KEY;
}

export async function generateSummary(article, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new SummaryGenerationError('NOT_CONFIGURED', '摘要服务尚未配置');
  }

  const { sourceText, sourceBasis } = await collectSourceText(article);
  // 红线：摘要必须基于原文。拿不到正文时直接说明情况，绝不拿标题和一句话描述
  // 去让模型"发挥"——那样产出的东西看着完整，实际全是编的。这里连模型都不调。
  if (sourceBasis === 'insufficient') {
    return { summary: INSUFFICIENT_SOURCE_MESSAGE, insufficient: true };
  }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    throw new SummaryGenerationError('SOURCE_TOO_LONG', '内容过长，当前版本暂不能处理');
  }

  const userMessage = buildSummaryInput(article, sourceText, sourceBasis);
  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUMMARY_REQUEST_TIMEOUT_MS);
    response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: 4_000,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new SummaryGenerationError('TIMEOUT', '摘要生成超时，请稍后重试', { cause: error });
    }
    throw new SummaryGenerationError('CONNECTION', '暂时无法连接摘要服务', { cause: error });
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new SummaryGenerationError('AUTH', '摘要服务配置不可用');
    }
    if (status === 429) {
      throw new SummaryGenerationError('RATE_LIMIT', '摘要请求较多，请稍后重试');
    }
    throw new SummaryGenerationError('UPSTREAM', `摘要服务返回 ${status}，请稍后重试`);
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new SummaryGenerationError('UPSTREAM', '摘要服务返回格式异常', { cause: error });
  }

  const choice = body.choices?.[0];
  if (!choice) {
    throw new SummaryGenerationError('EMPTY_OUTPUT', '摘要服务未返回结果');
  }
  if (choice.finish_reason === 'length') {
    throw new SummaryGenerationError('OUTPUT_TRUNCATED', '萃取结果未完整生成，请重试');
  }

  const rawText = choice.message?.content || '';
  const summary = validateSummaryOutput(rawText);

  return { summary, basedOnDescription: false, insufficient: false, sourceBasis };
}

async function collectSourceText(article) {
  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      try {
        const transcript = await fetchTranscript(videoId);
        const text = transcript.map(item => item.text).join(' ').trim();
        if (text.length >= MIN_CONTENT_CHARS) return { sourceText: text, sourceBasis: 'transcript' };
      } catch {
        // 字幕不可用，走 insufficient，不降级去编
      }
    }
  }

  if (article.channel_type === 'wechat') {
    // 缓存的正文也要过长度线：纯图片文章缓存下来的往往只有标题那一行
    if (article.content && article.content.length >= MIN_CONTENT_CHARS) {
      return { sourceText: article.content, sourceBasis: 'content' };
    }
    try {
      const content = await fetchArticleContent({
        externalId: article.external_id, url: article.url, title: article.title,
      });
      if (content && content.length >= MIN_CONTENT_CHARS) {
        db.run('UPDATE articles SET content = ? WHERE id = ?', [content, article.id]);
        db.save();
        return { sourceText: content, sourceBasis: 'content' };
      }
    } catch {
      // 正文获取失败，走 insufficient，不降级去编
    }
  }

  return { sourceText: '', sourceBasis: 'insufficient' };
}

function extractVideoId(url = '') {
  const patterns = [
    /v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match) return match[1];
  }
  return null;
}
