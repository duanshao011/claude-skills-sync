import { fetchTranscript } from 'youtube-transcript';
import { createRedfoxClient } from './clients/redfox.js';
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

export function isAvailable() {
  return !!process.env.DEEPSEEK_API_KEY;
}

export async function generateSummary(article, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new SummaryGenerationError('NOT_CONFIGURED', '摘要服务尚未配置');
  }

  const { sourceText, sourceBasis } = await collectSourceText(article);
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

  return {
    summary,
    basedOnDescription: sourceBasis === 'description',
    sourceBasis,
  };
}

async function collectSourceText(article) {
  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      try {
        const transcript = await fetchTranscript(videoId);
        const text = transcript.map(item => item.text).join(' ').trim();
        if (text.length >= 50) return { sourceText: text, sourceBasis: 'transcript' };
      } catch {
        // 字幕不可用时降级到描述
      }
    }
  }

  if (article.channel_type === 'wechat') {
    if (article.content) {
      return { sourceText: article.content, sourceBasis: 'content' };
    }
    try {
      const client = createRedfoxClient();
      const data = article.external_id
        ? await client.queryWork({ workUuid: article.external_id })
        : await client.queryArticleDetail({ url: article.url });
      if (data?.content && data.content.length >= 50) {
        db.run('UPDATE articles SET content = ? WHERE id = ?', [data.content, article.id]);
        db.save();
        return { sourceText: data.content, sourceBasis: 'content' };
      }
    } catch {
      // 正文获取失败时降级到描述
    }
  }

  const title = article.title_cn || article.title || '无标题';
  const description = article.summary_cn || article.summary || '无可用描述';
  return {
    sourceText: `标题：${title}\n\n来源描述：${description}`,
    sourceBasis: 'description',
  };
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
