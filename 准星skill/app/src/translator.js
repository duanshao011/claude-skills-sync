export function isAvailable() {
  return !!process.env.DEEPSEEK_API_KEY;
}

const BASE_URL = () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function chatComplete(system, userText, maxTokens = 500) {
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
    throw new Error(`DeepSeek API 调用失败: ${json?.error?.message || `HTTP ${resp.status}`}`);
  }
  return json?.choices?.[0]?.message?.content || '';
}

export async function translateArticles(articles) {
  if (!isAvailable()) return articles;

  for (const a of articles) {
    if (a.title_cn) continue;

    try {
      const result = await translateOne(a.title, a.summary || '');
      a.title_cn = result.title;
      a.summary_cn = result.summary;
    } catch (err) {
      console.error('[Translator] Failed for:', a.title.slice(0, 30), '-', err.message);
    }
  }

  return articles;
}

async function translateOne(title, summary) {
  const text = summary
    ? `标题: ${title}\n描述: ${summary.slice(0, 300)}`
    : `标题: ${title}`;

  const output = await chatComplete(
    '你是一个中英翻译助手，输出简洁准确的简体中文译文。',
    `将以下YouTube视频信息翻译成简体中文。只输出两行，第一行是标题译文，第二行是描述译文（如果没有描述则只输出一行标题译文）：

${text}`
  );

  const lines = output.trim().split('\n').filter(l => l.trim());
  let cnTitle = lines[0]?.trim() || null;
  let cnSummary = lines[1]?.trim() || null;

  // Strip common prefixes the model may add
  if (cnTitle) cnTitle = cnTitle.replace(/^(标题[：:]\s*|译文[：:]\s*)/, '');
  if (cnSummary) cnSummary = cnSummary.replace(/^(描述[：:]\s*|摘要[：:]\s*)/, '');

  return { title: cnTitle, summary: cnSummary };
}
