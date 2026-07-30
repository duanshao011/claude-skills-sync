// RedFox API fetcher — unified interface for Chinese social platforms
// Supported platforms: douyin-hot (抖音), xiaohongshu (小红书), bilibili (B站)
// Auth: X-API-KEY header, key from REDFOX_API_KEY env

const API_BASE = 'https://redfox.hk/story/api';
const API_KEY = () => process.env.REDFOX_API_KEY;

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-API-KEY': API_KEY(),
  };
}

function isAvailable() {
  return !!API_KEY();
}

// ─── Platform-specific fetch ───────────────────────────────────────────

async function fetchDouyinHot(keyword) {
  const today = new Date();
  const yesterday = new Date(today - 86400000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const body = {
    type: keyword || '全部',
    startTime: fmt(yesterday),
    endTime: fmt(today),
  };

  const resp = await fetch(`${API_BASE}/dy/search/likesRank`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '抖音API错误');

  return (json.data || []).map(item => ({
    title: item.title || item.content?.slice(0, 80) || `@${item.accountName || ''} 的作品`,
    url: item.workUrl || `https://www.douyin.com/video/${item.workId}`,
    summary: (item.content || '').slice(0, 200),
    thumbnail: item.coverUrl || '',
    published_at: item.publishTime || null,
    meta: {
      author: item.accountName,
      likes: item.likeCount,
      comments: item.commentCount,
      shares: item.shareCount,
    },
  }));
}

async function fetchXiaohongshu(keyword) {
  const body = { keyword, pageNum: 1, pageSize: 50, source: 'zhunxing' };

  const resp = await fetch(`${API_BASE}/xhs/search/search`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '小红书API错误');

  const list = json.data?.articles || [];
  return list.map(item => ({
    title: item.title || '(无标题)',
    url: item.shareInfoLink || `https://www.xiaohongshu.com/explore/${item.id}`,
    summary: (item.desc || '').slice(0, 200),
    thumbnail: item.cover || '',
    published_at: item.createTime || null,
    meta: {
      author: item.authorNickname || '',
      likes: item.likedCount,
      comments: item.commentsCount,
      shares: item.sharedCount,
    },
  }));
}

async function fetchBilibili(keyword) {
  const body = { keyword, sortType: 1, publishTime: 7, page: 1, source: 'zhunxing' };

  const resp = await fetch(`${API_BASE}/bili/search`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || 'B站API错误');

  const list = json.data?.opusInfoList || [];
  return list.map(item => ({
    title: stripHtml(item.title || ''),
    url: item.url || `https://www.bilibili.com/video/${item.bvId || ''}`,
    summary: (item.description || '').slice(0, 200),
    thumbnail: (item.cover || '').startsWith('//') ? `https:${item.cover}` : (item.cover || ''),
    published_at: item.publishTime ? new Date(item.publishTime * 1000).toISOString() : null,
    meta: {
      author: item.nickname,
      views: item.viewNum,
      likes: item.likeNum,
      comments: item.commentNum,
    },
  }));
}

// ─── 抖音达人（按昵称追踪）────────────────────────────────────────

async function fetchDouyinAccount(accountName) {
  const body = { accountName, source: 'zhunxing' };

  const resp = await fetch(`${API_BASE}/dyData/queryUserWithWorks`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '抖音API错误');

  const data = json.data || {};
  const works = data.workList || [];
  return works.map(item => ({
    title: item.title || '(无标题)',
    url: item.url || '',
    summary: item.title || '',
    thumbnail: item.coverUrl || '',
    published_at: item.publishTime || null,
    meta: {
      author: data.nickname || accountName,
      accountId: data.accountId,
      followers: data.followerCount,
      likes: item.likeCount,
      comments: item.commentCount,
      shares: item.shareCount,
    },
  }));
}

// ─── 公众号（按名称搜索）───────────────────────────────────────────

async function fetchGongzhonghao(keyword) {
  const today = new Date();
  const weekAgo = new Date(today - 7 * 86400000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const body = {
    keyword,
    startDate: fmt(weekAgo),
    endDate: fmt(today),
    source: 'zhunxing',
  };

  const resp = await fetch(`${API_BASE}/gzh/search/hotArticleNew`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '公众号API错误');

  const list = json.data?.articles || [];
  return list.map(item => ({
    title: item.title || '(无标题)',
    url: item.url || '',
    summary: (item.summary || '').slice(0, 200),
    thumbnail: item.imageUrl || '',
    published_at: item.publicTime || null,
    meta: {
      author: item.author || '',
      reads: item.clicksCount,
      likes: item.likeCount,
      shares: item.shareCount,
      comments: item.commentsCount,
    },
  }));
}

// ─── Platform router ───────────────────────────────────────────────────

const PLATFORM_FETCHERS = {
  'douyin-hot': fetchDouyinHot,
  'douyin-account': fetchDouyinAccount,
  xiaohongshu: fetchXiaohongshu,
  bilibili: fetchBilibili,
  gongzhonghao: fetchGongzhonghao,
};

export async function fetchChannel(channelId, channelType) {
  if (!isAvailable()) {
    throw new Error('未配置 REDFOX_API_KEY，请在 .env 中设置');
  }

  const fetcher = PLATFORM_FETCHERS[channelType];
  if (!fetcher) {
    throw new Error(`不支持的平台类型: ${channelType}`);
  }

  if (!channelId || !channelId.trim()) {
    throw new Error('关键词不能为空');
  }

  return fetcher(channelId.trim());
}

// ─── Validation ────────────────────────────────────────────────────────

export async function validate(channelId) {
  if (!isAvailable()) {
    return { valid: false, reason: '未配置 REDFOX_API_KEY' };
  }
  if (!channelId || !channelId.trim()) {
    return { valid: false, reason: '关键词不能为空' };
  }
  return { valid: true, keyword: channelId.trim() };
}

export function parseChannelUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { type: 'error', reason: '关键词不能为空' };
  }
  return { type: 'keyword', value: trimmed };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

export { isAvailable };
