import Anthropic from '@anthropic-ai/sdk';

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

export async function translateArticles(articles) {
  const c = getClient();
  if (!c) return articles;

  for (const a of articles) {
    if (a.title_cn) continue;

    try {
      const result = await translateOne(c, a.title, a.summary || '');
      a.title_cn = result.title;
      a.summary_cn = result.summary;
    } catch (err) {
      console.error('[Translator] Failed for:', a.title.slice(0, 30), '-', err.message);
    }
  }

  return articles;
}

async function translateOne(client, title, summary) {
  const text = summary
    ? `标题: ${title}\n描述: ${summary.slice(0, 300)}`
    : `标题: ${title}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    thinking: { type: 'disabled' },
    messages: [{
      role: 'user',
      content: `将以下YouTube视频信息翻译成简体中文。只输出两行，第一行是标题译文，第二行是描述译文（如果没有描述则只输出一行标题译文）：

${text}`
    }],
  });

  const txtBlock = response.content.find(b => b.type === 'text');
  const output = (txtBlock?.text || '').trim();
  const lines = output.split('\n').filter(l => l.trim());

  let cnTitle = lines[0]?.trim() || null;
  let cnSummary = lines[1]?.trim() || null;

  // Strip common prefixes Claude may add
  if (cnTitle) cnTitle = cnTitle.replace(/^(标题[：:]\s*|译文[：:]\s*)/, '');
  if (cnSummary) cnSummary = cnSummary.replace(/^(描述[：:]\s*|摘要[：:]\s*)/, '');

  return { title: cnTitle, summary: cnSummary };
}
