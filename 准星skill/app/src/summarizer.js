import { fetchTranscript } from 'youtube-transcript';

export function isAvailable() {
  return !!process.env.DEEPSEEK_API_KEY;
}

const BASE_URL = () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Call DeepSeek (OpenAI-compatible) chat completions
async function chatComplete(system, userText, maxTokens = 1024) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  const resp = await fetch(`${BASE_URL()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const err = json?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`DeepSeek API 调用失败: ${err}`);
  }

  return json?.choices?.[0]?.message?.content || '';
}

const SUMMARY_PROMPT = `请阅读以下内容，用中文按三段式结构输出简洁摘要：

{content}

请严格按以下格式输出：
【这篇文章在讲什么】
一句话说清主题

【作者为什么这么说】
• 论据1
• 论据2
• 论据3

【对我们有什么用】
• 可执行的启示1
• 可执行的启示2`;

export async function generateSummary(article) {
  let inputText = '';
  let basedOnDescription = false;

  // 公众号：优先用正文生成摘要
  if (article.channel_type === 'gongzhonghao') {
    const content = (article.content || '').replace(/\s+/g, ' ').trim();
    if (content.length >= 100) {
      inputText = content;
    } else {
      inputText = `标题: ${article.title}\n\n摘要: ${article.summary || '无摘要'}`;
      basedOnDescription = true;
    }
  }

  // YouTube：尝试字幕
  if (!inputText && article.channel_type === 'youtube') {
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

  const summaryText = await chatComplete(
    '你是一个擅长提炼文章要点的中文摘要助手，输出精炼、准确、直接。',
    SUMMARY_PROMPT.replace('{content}', inputText)
  );

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
    /shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
