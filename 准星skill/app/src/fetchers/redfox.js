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

// ─── 公众号（按公众号名称拉取文章）─────────────────────────────────

async function fetchGongzhonghaoWorkList(accountName) {
  const today = new Date();
  const weekAgo = new Date(today - 7 * 86400000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const body = {
    uid: '',
    accountName,
    offset: 0,
    sortType: 'default',
    publishTimeStart: `${fmt(weekAgo)} 00:00:00`,
    publishTimeEnd: `${fmt(today)} 23:59:59`,
    source: 'zhunxing',
  };

  const resp = await fetch(`${API_BASE}/gzhData/queryWorkList`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();

  if (json.code === 3203) {
    throw new Error('RedFox 未收录该公众号（优质库暂未收录），无法抓取');
  }
  if (json.code !== 2000) throw new Error(json.msg || '公众号API错误');

  const raw = json.data;
  const list = Array.isArray(raw) ? raw : (raw?.list || raw?.articles || raw?.records || []);
  return list.map(item => ({
    title: item.title || '(无标题)',
    url: item.workUrl || '',
    summary: (item.summary || '').slice(0, 200),
    thumbnail: item.coverUrl || '',
    published_at: item.publishTime || null,
    workUuid: item.workUuid || '',
    meta: {
      author: item.author || '',
      reads: item.readCount,
      likes: item.likeCount,
      comments: item.commentCount,
      shares: item.shareCount,
      collects: item.collectCount,
    },
  }));
}

// ─── 公众号（按 workUuid 抓取文章正文）─────────────────────────────

async function fetchGongzhonghaoContent(workUuid) {
  const body = { source: 'zhunxing', workUuid };

  const resp = await fetch(`${API_BASE}/gzhData/queryWork`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '公众号正文获取失败');

  const d = Array.isArray(json.data) ? json.data[0] : json.data;
  return (d?.content || d?.workContent || d?.workText || '').trim();
}

// ─── 公众号（按名称搜索账号）────────────────────────────────────────

async function searchGongzhonghao(keyword) {
  const body = { keyword, source: 'zhunxing' };

  const resp = await fetch(`${API_BASE}/gzhData/searchUser`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 2000) throw new Error(json.msg || '公众号搜索失败');

  const raw = json.data;
  const list = Array.isArray(raw) ? raw : (raw?.list || raw?.accounts || []);
  return list.map(item => ({
    accountName: item.accountName || '',
    accountId: item.account || '',
    accountType: item.accountType || '',
    verifyInfo: item.verifyInfo || '',
    description: item.description || '',
    redfoxIndex: item.redfoxIndex || 0,
    lastPublishTime: item.lastPublishTime || null,
  }));
}

// ─── 公众号（验证是否被 RedFox 收录）───────────────────────────────

export async function verifyGongzhonghao(accountName) {
  try {
    const articles = await fetchGongzhonghaoWorkList(accountName);
    return { verified: true, articleCount: articles.length };
  } catch (err) {
    if (err.message.includes('未收录')) return { verified: false, reason: '未收录' };
    throw err;
  }
}

// ─── Platform router ───────────────────────────────────────────────────

const PLATFORM_FETCHERS = {
  'douyin-hot': fetchDouyinHot,
  'douyin-account': fetchDouyinAccount,
  xiaohongshu: fetchXiaohongshu,
  bilibili: fetchBilibili,
  gongzhonghao: fetchGongzhonghaoWorkList,
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

export { isAvailable, searchGongzhonghao, fetchGongzhonghaoContent };
