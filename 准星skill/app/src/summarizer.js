import Anthropic from '@anthropic-ai/sdk';
import { fetchTranscript } from 'youtube-transcript';
import {
  LONG_EXTRACT_SYSTEM_PROMPT,
  buildLongExtractInput,
  validateLongExtractOutput,
} from './prompts/long-extract.js';

export const SUMMARY_MODEL = 'claude-opus-4-8';
export const MAX_SOURCE_CHARS = 300_000;
export const SUMMARY_REQUEST_TIMEOUT_MS = 120_000;
export const SUMMARY_MAX_RETRIES = 1;

let client = null;

export class SummaryGenerationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SummaryGenerationError';
    this.code = code;
    this.requestId = options.requestId || null;
  }
}

export function isAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateSummary(article, options = {}) {
  const anthropicClient = options.client || getClient();
  const transcriptFetcher = options.transcriptFetcher || fetchTranscript;
  if (!anthropicClient) {
    throw new SummaryGenerationError('NOT_CONFIGURED', '摘要服务尚未配置');
  }

  const { sourceText, sourceBasis } = await collectSourceText(article, transcriptFetcher);
  if (sourceText.length > MAX_SOURCE_CHARS) {
    throw new SummaryGenerationError('SOURCE_TOO_LONG', '内容过长，当前版本暂不能处理');
  }

  let response;
  try {
    const stream = anthropicClient.messages.stream({
      model: SUMMARY_MODEL,
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: LONG_EXTRACT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildLongExtractInput(article, sourceText, sourceBasis),
      }],
    }, {
      timeout: SUMMARY_REQUEST_TIMEOUT_MS,
      maxRetries: SUMMARY_MAX_RETRIES,
    });
    response = await stream.finalMessage();
  } catch (error) {
    throw normalizeAnthropicError(error);
  }

  if (response.stop_reason === 'max_tokens') {
    throw new SummaryGenerationError('OUTPUT_TRUNCATED', '萃取结果未完整生成，请重试');
  }
  if (response.stop_reason === 'refusal') {
    throw new SummaryGenerationError('REFUSAL', '该内容暂时无法生成摘要');
  }
  if (response.stop_reason && response.stop_reason !== 'end_turn' && response.stop_reason !== 'stop_sequence') {
    throw new SummaryGenerationError('UNEXPECTED_STOP', '摘要服务未完成本次萃取，请重试');
  }

  const summary = validateLongExtractOutput(
    response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
  );

  return {
    summary,
    basedOnDescription: sourceBasis === 'description',
    sourceBasis,
  };
}

async function collectSourceText(article, transcriptFetcher) {
  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      try {
        const transcript = await transcriptFetcher(videoId);
        const text = transcript.map(item => item.text).join(' ').trim();
        if (text.length >= 50) return { sourceText: text, sourceBasis: 'transcript' };
      } catch {
        // 字幕不可用时使用来源描述，仍允许用户获得有限信息萃取。
      }
    }
  }

  const title = article.title_cn || article.title || '无标题';
  const description = article.summary_cn || article.summary || '无可用描述';
  return {
    sourceText: `标题：${title}\n\n来源描述：${description}`,
    sourceBasis: 'description',
  };
}

function normalizeAnthropicError(error) {
  const requestId = error?.request_id || error?.headers?.get?.('request-id') || null;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new SummaryGenerationError('AUTH', '摘要服务配置不可用', { cause: error, requestId });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new SummaryGenerationError('RATE_LIMIT', '摘要请求较多，请稍后重试', { cause: error, requestId });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new SummaryGenerationError('TIMEOUT', '摘要生成超时，请稍后重试', { cause: error, requestId });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new SummaryGenerationError('CONNECTION', '暂时无法连接摘要服务', { cause: error, requestId });
  }
  if (error instanceof Anthropic.InternalServerError || Number(error?.status) >= 500) {
    return new SummaryGenerationError('UPSTREAM', '摘要服务暂时不可用', { cause: error, requestId });
  }
  if (error instanceof SummaryGenerationError) return error;
  return new SummaryGenerationError('UPSTREAM', '摘要生成失败，请稍后重试', { cause: error, requestId });
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
