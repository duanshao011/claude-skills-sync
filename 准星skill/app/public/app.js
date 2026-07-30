// ===== State =====
const state = {
  dimension: 'blogger',
  bloggers: [],
  topics: [],
  currentArticles: [],
  selectedBloggerId: null,
  selectedTopicId: null,
  selectedArticleId: null,
  selectedArticle: null,
  summaryAvailable: false,
  pendingBloggerId: null,
};

// ===== Platform config =====
const PLATFORM_CONFIG = {
  youtube:       { label: 'YouTube',    color: '#ef4444', bg: '#fef2f2' },
  'douyin-hot':  { label: '抖音热门',    color: '#111',    bg: '#f9fafb' },
  'douyin-account': { label: '抖音达人', color: '#111',    bg: '#f9fafb' },
  xiaohongshu:   { label: '小红书',      color: '#ff2442', bg: '#fff0f3' },
  bilibili:      { label: 'B 站',       color: '#fb7299', bg: '#fff0f6' },
  gongzhonghao:  { label: '公众号',      color: '#07c160', bg: '#e8f5e9' },
};

function platformCfg(type) {
  return PLATFORM_CONFIG[type] || { label: type || '未知', color: '#9ca3af', bg: '#f9fafb' };
}

// ===== API =====
const api = {
  async get(path) { const r = await fetch(path); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async post(path, data) {
    const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||r.statusText); }
    return r.json();
  },
  async put(path, data) {
    const r = await fetch(path, { method:'PUT', headers: data ? {'Content-Type':'application/json'} : {}, body: data ? JSON.stringify(data) : undefined });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||r.statusText); }
    return r.json();
  },
  async del(path) { const r = await fetch(path, { method:'DELETE' }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
};

// ===== Init =====
async function init() {
  try {
    const config = await api.get('/api/config');
    state.summaryAvailable = config.summaryAvailable;
    if (!state.summaryAvailable) {
      document.getElementById('summaryBtn').classList.add('disabled');
      document.getElementById('summaryBtn').title = '需要配置 API Key';
    }
  } catch {}
  await loadBloggers();
  await loadTopics();
}

// ===== Data loading =====
async function loadBloggers() {
  state.bloggers = await api.get('/api/bloggers');
  renderSidebar();
}
async function loadTopics() {
  state.topics = await api.get('/api/topics');
}

// ===== Sidebar rendering =====
function renderSidebar() {
  const container = document.getElementById('sidebarList');
  const searchVal = (document.getElementById('sidebarSearch').value || '').toLowerCase();

  if (state.dimension === 'blogger') {
    const list = state.bloggers.filter(b =>
      !searchVal || b.name.toLowerCase().includes(searchVal)
    );
    const withContent = list.filter(b => b.unread_count > 0);
    const withoutContent = list.filter(b => b.unread_count === 0);

    let html = '';
    if (withContent.length) html += '<div class="list-group-label">有更新</div>';
    withContent.forEach(b => html += renderBloggerItem(b));
    if (withoutContent.length) html += '<div class="list-group-label">已读完</div>';
    withoutContent.forEach(b => html += renderBloggerItem(b));
    if (!list.length) html += '<div class="empty-hint">无匹配信息源</div>';
    container.innerHTML = html;
  } else {
    const list = state.topics.filter(t =>
      !searchVal || t.name.toLowerCase().includes(searchVal)
    );
    let html = '<div class="list-group-label">我的分组</div>';
    list.forEach(t => html += renderTopicItem(t));
    if (!list.length) html += '<div class="empty-hint">暂无分组</div>';
    container.innerHTML = html;
  }

  if (state.dimension === 'blogger' && state.selectedBloggerId) {
    const el = container.querySelector(`[data-blogger-id="${state.selectedBloggerId}"]`);
    if (el) el.classList.add('active');
  }
  if (state.dimension === 'topic' && state.selectedTopicId) {
    const el = container.querySelector(`[data-topic-id="${state.selectedTopicId}"]`);
    if (el) el.classList.add('active');
  }
}

function renderBloggerItem(b) {
  const cfg = platformCfg(b.channel_type);
  const abbr = b.name.charAt(0).toUpperCase();
  const badge = b.unread_count > 0 ? `<div class="avatar-badge">${b.unread_count}</div>` : '';
  const avatarHtml = b.avatar_url
    ? `<img class="list-avatar" src="${esc(b.avatar_url)}" style="border-radius:50%;object-fit:cover;width:34px;height:34px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="list-avatar" style="background:${b.avatar_color||'#ccc'};display:none;">${abbr}</div>`
    : `<div class="list-avatar" style="background:${b.avatar_color||'#ccc'};">${abbr}</div>`;
  return `
    <div class="list-item" data-blogger-id="${b.id}" onclick="selectBlogger(${b.id})">
      <div class="avatar-wrap">
        ${avatarHtml}
        ${badge}
      </div>
      <div class="list-info">
        <div class="list-name">${esc(b.name)}</div>
        <div class="list-meta">
          <span class="platform-dot" style="background:${cfg.color}"></span>
          ${cfg.label}
        </div>
      </div>
      <div class="hover-actions">
        <button class="act-btn tag-btn" title="归入分组" onclick="event.stopPropagation();showTagPopover(event,${b.id})">+</button>
        <button class="act-btn del-btn" title="取消关注" onclick="event.stopPropagation();showUnfollow(event,${b.id},'${esc(b.name)}')">&times;</button>
      </div>
    </div>`;
}

function renderTopicItem(t) {
  const badge = t.unread_count > 0 ? `<div class="topic-badge">${t.unread_count}</div>` : '';
  return `
    <div class="list-item" data-topic-id="${t.id}" onclick="selectTopic(${t.id})">
      <div class="topic-icon-wrap">
        <div class="list-topic-icon">${t.icon||'#'}</div>
        ${badge}
      </div>
      <div class="list-info">
        <div class="list-name">${esc(t.name)}</div>
        <div class="list-meta">${t.blogger_count||0} 个信息源</div>
      </div>
      <div class="hover-actions">
        <button class="act-btn edit-btn" title="编辑" onclick="event.stopPropagation();openTopicModal(event,${t.id})">+</button>
        <button class="act-btn del-btn" title="删除" onclick="event.stopPropagation();confirmDeleteTopic(event,${t.id},'${esc(t.name)}')">&times;</button>
      </div>
    </div>`;
}

// ===== Selection =====
async function selectBlogger(id) {
  state.dimension = 'blogger';
  state.selectedBloggerId = id;
  state.selectedTopicId = null;
  state.selectedArticleId = null;
  state.selectedArticle = null;

  document.querySelectorAll('.dim-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dim-tab[data-dim="blogger"]').classList.add('active');
  document.getElementById('addBtn').textContent = '+ 添加信息源';

  renderSidebar();
  const articles = await api.get(`/api/articles?blogger_id=${id}`);
  state.currentArticles = articles;
  renderArticleList(articles);
  clearContent();
}

async function selectTopic(id) {
  state.dimension = 'topic';
  state.selectedTopicId = id;
  state.selectedBloggerId = null;
  state.selectedArticleId = null;
  state.selectedArticle = null;

  document.querySelectorAll('.dim-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dim-tab[data-dim="topic"]').classList.add('active');
  document.getElementById('addBtn').textContent = '+ 新建分组';

  renderSidebar();
  const articles = await api.get(`/api/articles?topic_id=${id}`);
  state.currentArticles = articles;
  const topic = state.topics.find(t => t.id == id);
  renderArticleList(articles, { name: topic?.name, type: 'topic' });
  clearContent();
}

// ===== Article list =====
function renderArticleList(articles, source) {
  const header = document.getElementById('articleListHeader');
  const topBar = document.getElementById('topBar');
  const body = document.getElementById('articleListBody');

  if (source) {
    header.innerHTML = `<h2>${esc(source.name)}</h2>`;
    if (source.type === 'blogger') {
      const b = state.bloggers.find(x => x.id == state.selectedBloggerId);
      if (b) {
        const cfg = platformCfg(b.channel_type);
        header.innerHTML += `<div class="channel-tags"><span class="channel-tag" style="background:${cfg.bg};color:${cfg.color};border-color:${cfg.color}20;">${cfg.label}</span></div>`;
      }
    }
  } else {
    header.innerHTML = '<h2>选择一个信息源</h2>';
  }

  const unread = articles.filter(a => !a.is_read).length;
  let topHtml = '';
  if (articles.length > 0) {
    const latest = articles[0].published_at;
    topHtml = `<span><span class="stat-num">${unread}</span> 未读</span>`;
    if (latest) {
      const ago = timeAgo(latest);
      topHtml += `<span>&middot;</span><span>更新于 ${ago}</span>`;
    }
  }
  document.getElementById('topStats').innerHTML = topHtml;
  topBar.style.display = articles.length ? 'flex' : 'none';

  if (!articles.length) {
    body.innerHTML = '<div class="empty-hint">暂无内容</div>';
    return;
  }

  body.innerHTML = articles.map(a => {
    const cfg = platformCfg(a.channel_type);
    const cls = a.is_read ? '' : 'unread';
    const active = a.id == state.selectedArticleId ? ' active' : '';
    const snippet = (a.summary_cn || a.summary || '').slice(0, 100);
    const title = a.title_cn || a.title;
    const pubTime = a.published_at ? timeAgo(a.published_at) : '';
    return `
      <div class="article-item ${cls}${active}" data-article-id="${a.id}" onclick="selectArticle(${a.id})">
        <div class="article-title">${esc(title)}</div>
        <div class="article-snippet">${esc(snippet)}</div>
        <div class="article-meta">
          <span class="source-label" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span>
          <span>&middot;</span>
          <span>${pubTime}</span>
          <span>&middot;</span>
          <span>${esc(a.blogger_name)}</span>
        </div>
      </div>`;
  }).join('');

  if (state.selectedArticleId) {
    const el = body.querySelector(`[data-article-id="${state.selectedArticleId}"]`);
    if (el) el.classList.add('active');
  }

  document.getElementById('readAllBtn').style.display = source?.type === 'blogger' ? '' : 'none';
}

function clearContent() {
  document.getElementById('contentHeader').style.display = 'none';
  document.getElementById('contentBody').innerHTML = '<div class="empty-hint">选择一篇文章阅读</div>';
}

// ===== Select article =====
async function selectArticle(id) {
  state.selectedArticleId = id;
  const article = state.currentArticles.find(a => a.id == id);
  state.selectedArticle = article;

  document.querySelectorAll('.article-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-article-id="${id}"]`);
  if (el) el.classList.add('active');

  if (article && !article.is_read) {
    await api.put(`/api/articles/${id}/read`);
    article.is_read = 1;
    el?.classList.remove('unread');
    renderArticleList(state.currentArticles, getCurrentSource());
    loadBloggers();
  }

  renderContent(article);
}

function getCurrentSource() {
  if (state.selectedBloggerId) {
    const b = state.bloggers.find(x => x.id == state.selectedBloggerId);
    return b ? { name: b.name, type: 'blogger' } : null;
  }
  if (state.selectedTopicId) {
    const t = state.topics.find(x => x.id == state.selectedTopicId);
    return t ? { name: t.name, type: 'topic' } : null;
  }
  return null;
}

// ===== Content panel =====
function renderContent(article) {
  document.getElementById('contentHeader').style.display = 'flex';

  const cfg = platformCfg(article.channel_type);
  document.getElementById('sourceBadge').textContent = cfg.label;
  document.getElementById('sourceBadge').style.background = cfg.bg;
  document.getElementById('sourceBadge').style.color = cfg.color;
  document.getElementById('sourceBadge').style.border = `1px solid ${cfg.color}30`;

  const pubAt = article.published_at ? new Date(article.published_at) : null;
  document.getElementById('pubTime').textContent = pubAt
    ? `${pubAt.toLocaleDateString('zh-CN')} ${pubAt.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`
    : '';

  document.getElementById('originBtn').href = article.url || '#';
  document.getElementById('originBtn').style.display = article.url ? '' : 'none';

  const summaryBtn = document.getElementById('summaryBtn');
  if (state.summaryAvailable) {
    summaryBtn.classList.remove('disabled');
    summaryBtn.title = '';
    summaryBtn.onclick = () => generateSummary(article.id);
  } else {
    summaryBtn.classList.add('disabled');
    summaryBtn.title = '需要配置 API Key';
    summaryBtn.onclick = null;
  }

  let bodyHtml = `<h1>${esc(article.title_cn || article.title)}</h1>`;
  if (article.title_cn && article.title_cn !== article.title) {
    bodyHtml += `<div style="font-size:12px;color:#9ca3af;margin-top:-16px;margin-bottom:16px;">${esc(article.title)}</div>`;
  }

  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      bodyHtml += `<div class="video-wrap"><iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe></div>`;
    }
  } else if (article.thumbnail) {
    bodyHtml += `<img class="content-thumb" src="${esc(article.thumbnail)}" alt="" onerror="this.style.display='none'">`;
  }

  const descText = article.summary_cn || article.summary;
  if (descText) {
    bodyHtml += `<div class="desc">${esc(descText)}</div>`;
  }

  document.getElementById('contentBody').innerHTML = bodyHtml;
}

// ===== Summary =====
async function generateSummary(articleId) {
  const overlay = document.getElementById('summaryOverlay');
  const content = document.getElementById('summaryContent');
  overlay.style.display = 'flex';
  content.innerHTML = '<div class="loading-spinner">AI 摘要生成中...</div>';

  try {
    const result = await api.post(`/api/articles/${articleId}/summary`);
    content.innerHTML = esc(result.summary);
  } catch (err) {
    content.innerHTML = `<div style="color:#ef4444;">生成失败：${esc(err.message)}</div>`;
  }
}

// ===== Read all =====
document.getElementById('readAllBtn').addEventListener('click', async () => {
  if (!state.selectedBloggerId) return;
  await api.put(`/api/articles/read-all?blogger_id=${state.selectedBloggerId}`);
  state.currentArticles.forEach(a => a.is_read = 1);
  renderArticleList(state.currentArticles, getCurrentSource());
  loadBloggers();
});

// ===== Dimension tabs =====
document.querySelectorAll('.dim-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const dim = tab.dataset.dim;
    state.dimension = dim;
    document.querySelectorAll('.dim-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('addBtn').textContent = dim === 'blogger' ? '+ 添加信息源' : '+ 新建分组';
    renderSidebar();

    if (dim === 'blogger' && state.selectedBloggerId) {
      selectBlogger(state.selectedBloggerId);
    } else if (dim === 'topic' && state.selectedTopicId) {
      selectTopic(state.selectedTopicId);
    } else {
      state.selectedBloggerId = null;
      state.selectedTopicId = null;
      state.currentArticles = [];
      document.getElementById('articleListHeader').innerHTML = '<h2>选择一个信息源</h2>';
      document.getElementById('topBar').style.display = 'none';
      document.getElementById('articleListBody').innerHTML = '<div class="empty-hint">在左侧选择信息源开始浏览</div>';
      clearContent();
    }
  });
});

// ===== Search =====
document.getElementById('sidebarSearch').addEventListener('input', () => renderSidebar());

// ===== Tag popover =====
async function showTagPopover(e, bloggerId) {
  e.stopPropagation();
  const pop = document.getElementById('tagPopover');
  const list = document.getElementById('tagPopoverList');

  await loadTopics();
  const btResponse = state.topics;
  list.innerHTML = btResponse.map(t => {
    return `<div class="tag-option" data-topic-id="${t.id}" onclick="this.classList.toggle('checked')">
      <div class="tag-check">&check;</div>
      <span>${esc(t.icon||'#')}</span>
      <span>${esc(t.name)}</span>
    </div>`;
  }).join('');

  const rect = e.target.getBoundingClientRect();
  pop.style.top = rect.bottom + 4 + 'px';
  pop.style.left = Math.min(rect.left, innerWidth - 220) + 'px';
  pop.dataset.bloggerId = bloggerId;
  pop.classList.add('show');

  const bData = state.bloggers.find(b => b.id == bloggerId);
  if (bData) {
    try {
      const existing = await getBloggerTopics(bloggerId);
      const existingIds = existing.map(t => t.id);
      pop.querySelectorAll('.tag-option').forEach(opt => {
        if (existingIds.includes(Number(opt.dataset.topicId))) opt.classList.add('checked');
      });
    } catch {}
  }
}

async function getBloggerTopics(bloggerId) {
  const r = await fetch(`/api/bloggers/${bloggerId}/topics`);
  if (!r.ok) return [];
  const data = await r.json();
  return data.topics || [];
}

document.addEventListener('click', async function(e) {
  const pop = document.getElementById('tagPopover');
  if (!pop.classList.contains('show')) return;
  if (pop.contains(e.target) || e.target.classList.contains('tag-btn')) return;

  const bloggerId = pop.dataset.bloggerId;
  if (bloggerId) {
    const checked = [...pop.querySelectorAll('.tag-option.checked')];
    const topicIds = checked.map(c => Number(c.dataset.topicId));
    await api.put(`/api/bloggers/${bloggerId}/topics`, { topic_ids: topicIds });
    await loadBloggers();
    await loadTopics();
    renderSidebar();
    if (state.selectedBloggerId == bloggerId) {
      const articles = await api.get(`/api/articles?blogger_id=${bloggerId}`);
      state.currentArticles = articles;
      renderArticleList(articles, getCurrentSource());
    }
  }
  pop.classList.remove('show');
});

// ===== Unfollow =====
function showUnfollow(e, bloggerId, name) {
  e.stopPropagation();
  state.pendingBloggerId = bloggerId;
  const tip = document.getElementById('unfollowTooltip');
  document.getElementById('unfollowName').textContent = name;
  const rect = e.target.getBoundingClientRect();
  tip.style.top = rect.bottom + 4 + 'px';
  tip.style.left = Math.min(rect.left - 160, innerWidth - 240) + 'px';
  tip.classList.add('show');
}

document.querySelector('#unfollowTooltip .btn-cancel').addEventListener('click', () => {
  document.getElementById('unfollowTooltip').classList.remove('show');
  state.pendingBloggerId = null;
});

document.querySelector('#unfollowTooltip .btn-confirm').addEventListener('click', async () => {
  document.getElementById('unfollowTooltip').classList.remove('show');
  if (!state.pendingBloggerId) return;
  const id = state.pendingBloggerId;
  state.pendingBloggerId = null;

  await api.del(`/api/bloggers/${id}`);
  if (state.selectedBloggerId == id) {
    state.selectedBloggerId = null;
    state.selectedArticleId = null;
    state.selectedArticle = null;
    state.currentArticles = [];
    document.getElementById('articleListHeader').innerHTML = '<h2>选择一个信息源</h2>';
    document.getElementById('topBar').style.display = 'none';
    document.getElementById('articleListBody').innerHTML = '<div class="empty-hint">在左侧选择信息源开始浏览</div>';
    clearContent();
  }
  await loadBloggers();
  renderSidebar();
});

// ===== Topic modal =====
function openTopicModal(e, topicId) {
  e.stopPropagation();
  const modal = document.getElementById('topicModal');
  const topic = state.topics.find(t => t.id == topicId);
  if (!topic) return;

  document.getElementById('modalTitle').textContent = '编辑分组';
  document.getElementById('topicNameInput').value = topic.name;
  modal.dataset.topicId = topicId;
  modal.classList.add('show');
  renderChipBloggers(topicId);
}

async function renderChipBloggers(topicId) {
  const wrap = document.getElementById('chipWrap');
  const input = document.getElementById('chipSearch');
  wrap.querySelectorAll('.chip').forEach(c => c.remove());

  try {
    const r = await api.get(`/api/topics/${topicId}`);
    if (r.bloggers) {
      r.bloggers.forEach(b => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.innerHTML = `${esc(b.name)} <button class="chip-remove" data-blogger-id="${b.id}">&times;</button>`;
        wrap.insertBefore(chip, input);
      });
    }
  } catch {}
}

document.getElementById('chipWrap').addEventListener('click', function(e) {
  document.getElementById('chipSearch').focus();
});

document.getElementById('chipSearch').addEventListener('input', function() {
  const dd = document.getElementById('chipDropdown');
  const val = this.value.toLowerCase();
  const chippedIds = [...document.querySelectorAll('.chip-remove')].map(b => Number(b.dataset.bloggerId));
  const available = state.bloggers.filter(b => !chippedIds.includes(b.id) && b.name.toLowerCase().includes(val));

  dd.innerHTML = available.map(b => `
    <div class="chip-dropdown-item" data-blogger-id="${b.id}">
      <div class="dd-avatar" style="background:${b.avatar_color||'#ccc'};">${b.name.charAt(0).toUpperCase()}</div>
      <span class="dd-name">${esc(b.name)}</span>
      <span class="dd-channels">${platformCfg(b.channel_type).label}</span>
    </div>
  `).join('') || '<div class="chip-dropdown-item"><span style="color:#ccc;">无匹配</span></div>';
  dd.classList.add('show');
});

document.getElementById('chipDropdown').addEventListener('mousedown', function(e) {
  const item = e.target.closest('.chip-dropdown-item');
  if (!item || !item.dataset.bloggerId) return;
  e.preventDefault();

  const bid = Number(item.dataset.bloggerId);
  const b = state.bloggers.find(x => x.id == bid);
  if (!b) return;

  const wrap = document.getElementById('chipWrap');
  const input = document.getElementById('chipSearch');
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = `${esc(b.name)} <button class="chip-remove" data-blogger-id="${b.id}">&times;</button>`;
  wrap.insertBefore(chip, input);
  input.value = '';
  this.classList.remove('show');
});

document.getElementById('chipWrap').addEventListener('click', function(e) {
  if (e.target.classList.contains('chip-remove')) {
    e.target.parentElement.remove();
  }
});

// Topic modal save
document.querySelector('#topicModal .modal-btn.primary').addEventListener('click', async () => {
  const modal = document.getElementById('topicModal');
  const topicId = modal.dataset.topicId;
  const name = document.getElementById('topicNameInput').value.trim();
  if (!name) return;
  const bloggerIds = [...document.querySelectorAll('#chipWrap .chip-remove')].map(b => Number(b.dataset.bloggerId));

  if (topicId) {
    await api.put('/api/topics/' + topicId, { name, blogger_ids: bloggerIds });
  } else {
    await api.post('/api/topics', { name, icon: '#', blogger_ids: bloggerIds });
  }
  modal.classList.remove('show');
  await loadTopics();
  renderSidebar();
});

document.querySelector('#topicModal .modal-btn.secondary').addEventListener('click', () => {
  document.getElementById('topicModal').classList.remove('show');
});
document.querySelector('#topicModal .modal-close').addEventListener('click', () => {
  document.getElementById('topicModal').classList.remove('show');
});

function confirmDeleteTopic(e, topicId, name) {
  e.stopPropagation();
  if (!confirm(`确定删除分组「${name}」？信息源不会被取消关注。`)) return;
  api.del(`/api/topics/${topicId}`).then(() => {
    loadTopics();
    renderSidebar();
  });
}

// ===== Add blogger modal =====
const addModal = document.getElementById('addModal');
let validChannelId = null;
let validChannelName = null;
let currentAddChannel = 'youtube';

// Platform form config
function getFieldLabel(channel) {
  const labels = {
    youtube: '频道链接',
    'douyin-account': '达人昵称',
    gongzhonghao: '公众号名称',
  };
  return labels[channel] || '关键词';
}

function getPlaceholder(channel) {
  const placeholders = {
    youtube: 'https://www.youtube.com/@频道名',
    'douyin-account': '输入抖音达人昵称，如"科技狐"',
    xiaohongshu: '输入关键词，如"AI"、"穿搭"',
    bilibili: '输入关键词，如"编程"、"科技"',
    'douyin-hot': '输入分类或关键词，如"科技"、"美食"',
    gongzhonghao: '输入公众号名称，如"中国青年报"',
  };
  return placeholders[channel] || '输入关键词';
}

function needsValidation(channel) {
  return channel === 'youtube';
}

function updateAddForm() {
  document.getElementById('addFieldLabel').textContent = getFieldLabel(currentAddChannel);
  document.getElementById('addUrlInput').placeholder = getPlaceholder(currentAddChannel);
  document.getElementById('addUrlInput').value = '';
  document.getElementById('validateResult').textContent = '';
  document.getElementById('validateResult').className = 'validate-result';

  const validateBtn = document.getElementById('validateBtn');
  validateBtn.style.display = needsValidation(currentAddChannel) ? '' : 'none';

  document.getElementById('confirmAddBtn').disabled = needsValidation(currentAddChannel);
  validChannelId = null;
  validChannelName = null;
}

// Channel selector clicks
document.getElementById('channelSelect').addEventListener('click', function(e) {
  const opt = e.target.closest('.channel-option');
  if (!opt) return;

  this.querySelectorAll('.channel-option').forEach(o => o.classList.remove('active'));
  opt.classList.add('active');
  currentAddChannel = opt.dataset.channel;
  updateAddForm();
});

// Open modal
document.getElementById('addBtn').addEventListener('click', () => {
  if (state.dimension === 'topic') {
    document.getElementById('modalTitle').textContent = '新建分组';
    document.getElementById('topicNameInput').value = '';
    document.getElementById('chipWrap').querySelectorAll('.chip').forEach(c => c.remove());
    delete document.getElementById('topicModal').dataset.topicId;
    document.getElementById('topicModal').classList.add('show');
  } else {
    currentAddChannel = 'youtube';
    document.querySelectorAll('#channelSelect .channel-option').forEach(o => o.classList.remove('active'));
    const ytOpt = document.querySelector('#channelSelect .channel-option[data-channel="youtube"]');
    if (ytOpt) ytOpt.classList.add('active');
    updateAddForm();
    addModal.classList.add('show');
  }
});

document.querySelector('#addModal .modal-close').addEventListener('click', () => addModal.classList.remove('show'));
document.querySelector('#addModal .modal-btn.secondary').addEventListener('click', () => addModal.classList.remove('show'));

// Validate (YouTube only)
document.getElementById('validateBtn').addEventListener('click', async () => {
  const input = document.getElementById('addUrlInput').value.trim();
  if (!input) return;
  const result = document.getElementById('validateResult');
  result.textContent = '验证中...';
  result.className = 'validate-result';

  try {
    const data = await api.post('/api/fetch/validate', { channel_type: 'youtube', channel_input: input });
    if (data.valid) {
      validChannelId = data.channel_id;
      validChannelName = data.channel_name;
      result.textContent = `已找到：${data.channel_name}`;
      result.className = 'validate-result success';
      document.getElementById('confirmAddBtn').disabled = false;
    }
  } catch (err) {
    result.textContent = err.message;
    result.className = 'validate-result error';
    document.getElementById('confirmAddBtn').disabled = true;
  }
});

// Confirm add
document.getElementById('confirmAddBtn').addEventListener('click', async () => {
  if (currentAddChannel === 'youtube') {
    if (!validChannelId) return;
    try {
      const data = await api.post('/api/bloggers', {
        name: validChannelName,
        channel_type: 'youtube',
        channel_id: validChannelId,
      });
      addModal.classList.remove('show');
      try { await api.post(`/api/fetch/${data.id}`); } catch {}
      await loadBloggers();
      renderSidebar();
    } catch (err) {
      document.getElementById('validateResult').textContent = err.message;
      document.getElementById('validateResult').className = 'validate-result error';
    }
  } else {
    const keyword = document.getElementById('addUrlInput').value.trim();
    if (!keyword) {
      document.getElementById('validateResult').textContent = '请输入内容';
      document.getElementById('validateResult').className = 'validate-result error';
      return;
    }
    try {
      const data = await api.post('/api/bloggers', {
        name: keyword,
        channel_type: currentAddChannel,
        channel_id: keyword,
      });
      addModal.classList.remove('show');
      try { await api.post(`/api/fetch/${data.id}`); } catch {}
      await loadBloggers();
      renderSidebar();
    } catch (err) {
      document.getElementById('validateResult').textContent = err.message;
      document.getElementById('validateResult').className = 'validate-result error';
    }
  }
});

// Enter key for add input
document.getElementById('addUrlInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    if (needsValidation(currentAddChannel)) {
      document.getElementById('validateBtn').click();
    } else {
      document.getElementById('confirmAddBtn').click();
    }
  }
});

// ===== Summary overlay =====
document.getElementById('summaryClose').addEventListener('click', () => {
  document.getElementById('summaryOverlay').style.display = 'none';
});

document.getElementById('summaryOverlay').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});

// ===== Global click handlers =====
document.addEventListener('click', function(e) {
  const tip = document.getElementById('unfollowTooltip');
  if (tip.classList.contains('show') && !tip.contains(e.target) && !e.target.classList.contains('del-btn')) {
    tip.classList.remove('show');
    state.pendingBloggerId = null;
  }

  const dd = document.getElementById('chipDropdown');
  const chipWrap = document.getElementById('chipWrap');
  if (dd.classList.contains('show') && !chipWrap.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('show');
  }
});

document.getElementById('topicModal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('show');
});
addModal.addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('show');
});

// ===== Helpers =====
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function extractVideoId(url) {
  const patterns = [/v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /embed\/([\w-]{11})/, /shorts\/([\w-]{11})/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff/60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff/3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff/86400)} 天前`;
  return then.toLocaleDateString('zh-CN');
}

// ===== Start =====
init();
