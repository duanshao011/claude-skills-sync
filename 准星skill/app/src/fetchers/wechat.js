import { createRedfoxClient } from '../clients/redfox.js';

const PAGE_SIZE = 20;
const MAX_PAGES = 5;

export async function fetchChannel(channelId, options = {}) {
  const client = createRedfoxClient();
  const isWechatId = /^[a-zA-Z][a-zA-Z0-9_-]{5,}$/.test(channelId);
  const account = isWechatId ? channelId : '';
  const accountName = channelId;
  const articles = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await client.queryWechatWorkList({
      account,
      accountName,
      offset: page * PAGE_SIZE,
      publishTimeStart: options.cursor || undefined,
    });
    const rows = extractRows(data);
    articles.push(...rows.map(normalizeWork));
    if (rows.length < PAGE_SIZE) break;
  }
  return {
    articles,
    cursor: newestPublishTime(articles),
  };
}

export async function validate(channelInput) {
  const isWechatId = /^[a-zA-Z][a-zA-Z0-9_-]{5,}$/.test(channelInput);
  const account = isWechatId ? channelInput : '';
  const accountName = channelInput;
  const data = await createRedfoxClient().queryWechatWorkList({ account, accountName, offset: 0 });
  const rows = extractRows(data);
  return { valid: true, channel_id: channelInput, channel_name: rows[0]?.author || rows[0]?.accountName || channelInput };
}

function extractRows(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['list', 'articles', 'records']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function normalizeWork(work) {
  const publishedAt = work.publicTime || work.publishDate || work.publishTime || work.date || null;
  return {
    title: work.title || work.name || '',
    url: work.url || work.workUrl || '',
    externalId: work.workUuid || work.uuid || null,
    summary: work.summary || work.description || work.digest || work.abstract || null,
    thumbnail: work.cover || work.coverUrl || null,
    publishedAt,
  };
}

function newestPublishTime(articles) {
  const dates = articles.map(article => new Date(article.publishedAt)).filter(date => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(date => date.getTime()))).toISOString();
}
