import Anthropic from '@anthropic-ai/sdk';
import { fetchTranscript } from 'youtube-transcript';

let client = null;

export function isAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateSummary(article) {
  const client = getClient();
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  let inputText = '';
  let basedOnDescription = false;

  // Try to get YouTube transcript
  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      try {
        const transcript = await fetchTranscript(videoId);
        inputText = transcript.map(t => t.text).join(' ');
      } catch {
        // No transcript available, fall through
      }
    }
  }

  // Fallback: use title + RSS description
  if (!inputText || inputText.trim().length < 50) {
    inputText = `标题: ${article.title}\n\n描述: ${article.summary || '无描述'}`;
    basedOnDescription = true;
  }

  // Truncate to ~4000 tokens (rough estimate: 1 char ≈ 0.3 tokens for Chinese)
  if (inputText.length > 12000) {
    inputText = inputText.slice(0, 12000);
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `请用中文为以下视频内容生成结构化摘要：

${inputText}

请按以下格式输出：
核心观点：一句话概括视频最重要的结论
要点：
- 要点1
- 要点2
- 要点3
关键词：关键词1，关键词2，关键词3`
    }],
  });

  const summaryText = response.content[0].text;

  return {
    summary: summaryText,
    basedOnDescription,
  };
}

function extractVideoId(url) {
  const patterns = [
    /v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
