import { createRedfoxClient, isNoData } from '../clients/redfox.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../providers/errors.js';

const PAGE_SIZE = 20;
const MAX_PAGES = 5;
// 首次关注（无 cursor）只抓取近 30 篇，避免一次拉太多；后续更新走增量 cursor 不受此限。
const FIRST_FETCH_LIMIT = 30;
// 广域库不支持 publishTimeStart，增量更新只能「拉最新几页 + 本地按 cursor 截断」。
// 2 页 = 40 篇，覆盖任何正常发文频率；真追不上时下次更新会继续补。
const UPDATE_PAGES = 2;
const WECHAT_ID = /^[a-zA-Z][a-zA-Z0-9_-]{5,}$/;
const SEARCH_LIMIT = 20;

// ── 身份构造（纯函数，可测） ───────────────────────────────────────────
//
// 红狐的 queryWorkList 同时接受 account（微信号）和 accountName（名称），
// 但同时传两个会当成交集条件——实测 account + accountName 同值直接返回 3203。
// 因此必须二选一：有 channel_account（新流程/已回填）用微信号，否则退回
// 名称（未回填的老号）。正则 WECHAT_ID 兜底是不可靠的（GitHubDaily 这种
// 纯英文公众号名会被误判成微信号），只作为老号过渡手段。
export function buildIdentity(channelId, account) {
  const wechatId = account || (WECHAT_ID.test(channelId) ? channelId : '');
  return wechatId
    ? { account: wechatId }
    : { account: '', accountName: channelId };
}

// ── 账号搜索 ────────────────────────────────────────────────────────────

export async function search(keyword) {
  const query = String(keyword || '').trim();
  if (!query) throw new TypeError('keyword is required');
  const client = createRedfoxClient();
  let data = await client.searchWechatUser({ keyword: query });
  let rows = extractRows(data);
  // 优质库是抽样库，搜不到不代表这个号不存在，用覆盖更全的广域库兜底
  if (!rows.length) {
    data = await client.searchWechatUserWide({ keyword: query });
    rows = extractRows(data);
  }
  return {
    total: Number(data?.total) || rows.length,
    results: rows.slice(0, SEARCH_LIMIT).map(normalizeAccount),
  };
}

export function normalizeAccount(row) {
  return {
    account: row.account || '',
    name: row.accountName || '',
    avatar_url: row.avatarUrl || null,
    description: row.description || '',
    verify_info: row.verifyInfo || '',
    last_article_title: row.lastArticleTitle || '',
    last_publish_time: normalizeTimestamp(row.lastPublishTime),
  };
}

// ── 回填匹配规则（纯函数，可测） ────────────────────────────────────────

// 老号回填时绝不能猜：候选必须和已存名称精确且唯一对应。宁可放弃头像，
// 也不能把用户的关注绑到另一个同名号上。
export function pickAccountMatch(name, results) {
  const target = String(name || '').trim();
  const exact = results.filter(item => item.name === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = results.filter(item => item.name.toLowerCase() === target.toLowerCase());
  return loose.length === 1 ? loose[0] : null;
}

// ── 抓取 ────────────────────────────────────────────────────────────────

// 增量截断：广域库拿不到「只要 cursor 之后的」，只能整页拉回来本地筛。
// caughtUp 表示本页已经出现不新于 cursor 的文章，说明追上了，不用再翻页。
// 日期解析不出来的文章一律当新的保留，宁可重复也不漏（下游 insertArticles 会按 workUuid 去重）。
export function splitByCursor(articles, cursor) {
  const cursorTime = cursor ? new Date(cursor).getTime() : NaN;
  if (Number.isNaN(cursorTime)) return { fresh: articles, caughtUp: false };
  const fresh = articles.filter(article => {
    // 注意 new Date(null) 是 1970 而不是 Invalid Date，空值必须先挡掉，否则会被当成最旧的丢弃
    if (!article.publishedAt) return true;
    const time = new Date(article.publishedAt).getTime();
    return Number.isNaN(time) || time > cursorTime;
  });
  return { fresh, caughtUp: fresh.length < articles.length };
}

export async function fetchChannel(channelId, options = {}) {
  const account = options.account || null;
  // 广域库覆盖全量（实测是优质库的 6-8 倍，且优质库会对个别账号停止同步），
  // 但它只认微信号。没有微信号的老号、或广域库不可用时回落优质库。
  if (account) {
    try {
      const wide = await fetchFromWide(account, options);
      if (!wide.noData) return wide;
    } catch (error) {
      console.error('[Wechat] 广域库抓取失败，回落优质库:', error.message);
    }
  }
  return fetchFromCurated(channelId, options);
}

async function fetchFromWide(account, options) {
  const client = createRedfoxClient();
  const isFirstFetch = !options.cursor;
  const limit = isFirstFetch ? FIRST_FETCH_LIMIT : Infinity;
  const maxPages = isFirstFetch ? MAX_PAGES : UPDATE_PAGES;
  const articles = [];
  let channelName = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await client.queryWechatWorkListWide({ account, offset: page * PAGE_SIZE });
    if (page === 0 && isNoData(data)) return { articles: [], cursor: null, channelName: null, noData: true };
    const rows = extractRows(data);
    if (!rows.length) break;
    if (!channelName) channelName = rows[0].author || rows[0].accountName || null;

    const { fresh, caughtUp } = splitByCursor(rows.map(normalizeWork), options.cursor);
    articles.push(...fresh);
    if (caughtUp || rows.length < PAGE_SIZE || articles.length >= limit) break;
  }

  return {
    articles: articles.slice(0, limit),
    cursor: newestPublishTime(articles),
    channelName,
    noData: false,
  };
}

async function fetchFromCurated(channelId, options) {
  const identity = buildIdentity(channelId, options.account || null);
  const isFirstFetch = !options.cursor;
  const limit = isFirstFetch ? FIRST_FETCH_LIMIT : Infinity;
  const articles = [];
  let channelName = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await createRedfoxClient().queryWechatWorkList({
      ...identity,
      offset: page * PAGE_SIZE,
      publishTimeStart: options.cursor || undefined,
    });
    const rows = extractRows(data);
    if (!channelName && rows[0]) channelName = rows[0].author || rows[0].accountName || null;
    articles.push(...rows.map(normalizeWork));
    if (rows.length < PAGE_SIZE || articles.length >= limit) break;
  }
  return {
    articles: articles.slice(0, limit),
    cursor: newestPublishTime(articles),
    channelName,
  };
}

// ── 验证 ────────────────────────────────────────────────────────────────

export async function validate(channelInput) {
  const identity = buildIdentity(channelInput, null);
  const data = await createRedfoxClient().queryWechatWorkList({ ...identity, offset: 0 });
  const rows = extractRows(data);
  if (isNoData(data) || rows.length === 0) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.FETCH_FAILED,
      `红狐优质库暂未收录公众号「${channelInput}」，加了也抓不到内容。请先核对名称与公众号主页完全一致；名称无误则说明该号不在收录范围内。`,
      { provider: 'wechat', retryable: false }
    );
  }
  return { valid: true, channel_id: channelInput, channel_name: rows[0]?.author || rows[0]?.accountName || channelInput };
}

// ── 内部工具 ────────────────────────────────────────────────────────────

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

function normalizeTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  return value;
}
