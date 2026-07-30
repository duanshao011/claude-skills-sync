import { createRedfoxClient } from '../clients/redfox.js';

export async function fetchChannel(channelId) {
  const identity = parseIdentity(channelId);
  const data = await createRedfoxClient().queryDouyinUserWithWorks(identity);
  const works = data?.workList || [];
  return {
    articles: works.map(work => ({
      title: work.title || '',
      url: work.url || '',
      externalId: work.awemeId || work.workId || null,
      summary: null,
      thumbnail: work.cover || null,
      publishedAt: normalizeTimestamp(work.publishTime),
    })),
    cursor: works[0]?.publishTime ? String(works[0].publishTime) : null,
  };
}

export async function validate(channelInput) {
  const identity = parseIdentity(channelInput);
  const data = await createRedfoxClient().queryDouyinUserWithWorks(identity);
  return {
    valid: true,
    channel_id: data?.accountId || identity.accountId || identity.accountName,
    channel_name: data?.nickname || data?.uniqueId || identity.accountName || identity.accountId,
    avatar_url: data?.avatar || data?.avatarUrl || null,
  };
}

function parseIdentity(input) {
  const value = String(input || '').trim();
  if (!value) throw new TypeError('Douyin account identifier is required');
  return value.startsWith('@') ? { accountName: value.slice(1) } : { accountId: value };
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  return value;
}
