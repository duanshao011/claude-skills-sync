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
  pendingBloggerId: null, // for unfollow
};

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
      document.getElementById('summaryBtn').title = '需要配置 ANTHROPIC_API_KEY';
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
    if (withContent.length) html += '<div class="list-group-label">有新内容</div>';
    withContent.forEach(b => html += renderBloggerItem(b));
    if (withoutContent.length) html += '<div class="list-group-label">已读完</div>';
    withoutContent.forEach(b => html += renderBloggerItem(b));
    if (!list.length) html += '<div class="empty-hint">无匹配博主</div>';
    container.innerHTML = html;
  } else {
    const list = state.topics.filter(t =>
      !searchVal || t.name.toLowerCase().includes(searchVal)
    );
    let html = '<div class="list-group-label">我的主题</div>';
    list.forEach(t => html += renderTopicItem(t));
    if (!list.length) html += '<div class="empty-hint">暂无主题，点击下方新建</div>';
    container.innerHTML = html;
  }

  // Restore selection highlight
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
  const abbr = b.name.charAt(0);
  const badge = b.unread_count > 0 ? `<div class="avatar-badge">${b.unread_count}</div>` : '';
  return `
    <div class="list-item" data-blogger-id="${b.id}" onclick="selectBlogger(${b.id})">
      <div class="avatar-wrap">
        <div class="list-avatar" style="background:${b.avatar_color||'#ccc'};">${abbr}</div>
        ${badge}
      </div>
      <div class="list-info">
        <div class="list-name">${esc(b.name)}</div>
        <div class="list-meta">${esc(b.channel_type)}</div>
      </div>
      <div class="hover-actions">
        <button class="act-btn tag-btn" title="归入主题" onclick="event.stopPropagation();showTagPopover(event,${b.id})">🏷</button>
        <button class="act-btn del-btn" title="取消关注" onclick="event.stopPropagation();showUnfollow(event,${b.id},'${esc(b.name)}')">✕</button>
      </div>
    </div>`;
}

function renderTopicItem(t) {
  const badge = t.unread_count > 0 ? `<div class="topic-badge">${t.unread_count}</div>` : '';
  return `
    <div class="list-item" data-topic-id="${t.id}" onclick="selectTopic(${t.id})">
      <div class="topic-icon-wrap">
        <div class="list-topic-icon" style="background:#eef0ff;">${t.icon||'📌'}</div>
        ${badge}
      </div>
      <div class="list-info">
        <div class="list-name">${esc(t.name)}</div>
        <div class="list-meta">${t.blogger_count||0} 位博主</div>
      </div>
      <div class="hover-actions">
        <button class="act-btn edit-btn" title="编辑主题" onclick="event.stopPropagation();openTopicModal(event,${t.id})">✎</button>
        <button class="act-btn del-btn" title="删除主题" onclick="event.stopPropagation();confirmDeleteTopic(event,${t.id},'${esc(t.name)}')">✕</button>
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
  document.getElementById('addBtn').textContent = '+ 添加博主';

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
  document.getElementById('addBtn').textContent = '+ 新建主题';

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
        header.innerHTML += `<div class="channel-tags"><span class="channel-tag" style="background:#fff0f0;color:#ff5252;">${esc(b.channel_type)}</span></div>`;
      }
    }
  } else {
    header.innerHTML = `<h2>选择一位博主</h2>`;
  }

  const unread = articles.filter(a => !a.is_read).length;
  let topHtml = '';
  if (articles.length > 0) {
    const latest = articles[0].published_at;
    topHtml = `<span><span class="stat-num">${unread}</span> 条未读</span>`;
    if (latest) {
      const ago = timeAgo(latest);
      topHtml += `<span>·</span><span>最近更新 ${ago}</span>`;
    }
  }
  document.getElementById('topStats').innerHTML = topHtml;
  topBar.style.display = articles.length ? 'flex' : 'none';

  if (!articles.length) {
    body.innerHTML = '<div class="empty-hint">暂无内容</div>';
    return;
  }

  body.innerHTML = articles.map(a => {
    const cls = a.is_read ? '' : 'unread';
    const active = a.id == state.selectedArticleId ? ' active' : '';
    const channelLabel = a.channel_type === 'youtube' ? 'YouTube' : (a.channel_type || '');
    const dotColor = a.channel_type === 'youtube' ? '#ff0000' : '#ff5252';
    const snippet = (a.summary || '').slice(0, 100);
    const pubTime = a.published_at ? timeAgo(a.published_at) : '';
    return `
      <div class="article-item ${cls}${active}" data-article-id="${a.id}" onclick="selectArticle(${a.id})">
        <div class="article-title">${esc(a.title)}</div>
        <div class="article-snippet">${esc(snippet)}</div>
        <div class="article-meta">
          <span class="source-dot" style="background:${dotColor};"></span>
          ${esc(channelLabel)} · ${pubTime} · ${esc(a.blogger_name)}
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

  // Update article list highlight
  document.querySelectorAll('.article-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-article-id="${id}"]`);
  if (el) el.classList.add('active');

  // Mark as read
  if (article && !article.is_read) {
    await api.put(`/api/articles/${id}/read`);
    article.is_read = 1;
    el?.classList.remove('unread');
    renderArticleList(state.currentArticles, getCurrentSource());
    loadBloggers(); // refresh sidebar counts
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

  const channelLabel = article.channel_type === 'youtube' ? 'YouTube' : (article.channel_type || '');
  const iconColor = article.channel_type === 'youtube' ? '#fff0f0;color:#ff0000' : '#fff0f0;color:#ff5252';
  document.getElementById('sourceIcon').innerHTML = `<span style="background:${iconColor.split(';')[0]};color:${iconColor.split('color:')[1]};padding:3px 8px;border-radius:6px;font-size:10px;font-weight:500;">${channelLabel}</span>`;

  const pubAt = article.published_at ? new Date(article.published_at) : null;
  document.getElementById('pubTime').textContent = pubAt
    ? `${pubAt.toLocaleDateString('zh-CN')} ${pubAt.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 发布`
    : '';

  document.getElementById('originBtn').href = article.url || '#';
  document.getElementById('originBtn').style.display = article.url ? '' : 'none';
  document.getElementById('favBtn').style.display = 'none'; // Future feature

  // Summary button
  const summaryBtn = document.getElementById('summaryBtn');
  if (state.summaryAvailable) {
    summaryBtn.classList.remove('disabled');
    summaryBtn.title = '';
    summaryBtn.onclick = () => generateSummary(article.id);
  } else {
    summaryBtn.classList.add('disabled');
    summaryBtn.title = '需要配置 ANTHROPIC_API_KEY';
    summaryBtn.onclick = null;
  }

  let bodyHtml = `<h1>${esc(article.title)}</h1>`;

  // YouTube embed
  if (article.channel_type === 'youtube') {
    const videoId = extractVideoId(article.url);
    if (videoId) {
      bodyHtml += `<div class="video-wrap"><iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe></div>`;
    }
  }

  if (article.summary) {
    bodyHtml += `<div class="desc">${esc(article.summary)}</div>`;
  }

  document.getElementById('contentBody').innerHTML = bodyHtml;
}

// ===== Summary =====
async function generateSummary(articleId) {
  const overlay = document.getElementById('summaryOverlay');
  const content = document.getElementById('summaryContent');
  overlay.style.display = 'flex';
  content.innerHTML = '<div class="loading-spinner">AI 摘要生成中…（大约需要 10-20 秒）</div>';

  try {
    const result = await api.post(`/api/articles/${articleId}/summary`);
    content.innerHTML = esc(result.summary);
  } catch (err) {
    content.innerHTML = `<div style="color:#ff5252;">生成失败：${esc(err.message)}</div>`;
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
    document.getElementById('addBtn').textContent = dim === 'blogger' ? '+ 添加博主' : '+ 新建主题';
    renderSidebar();

    if (dim === 'blogger' && state.selectedBloggerId) {
      selectBlogger(state.selectedBloggerId);
    } else if (dim === 'topic' && state.selectedTopicId) {
      selectTopic(state.selectedTopicId);
    } else {
      state.selectedBloggerId = null;
      state.selectedTopicId = null;
      state.currentArticles = [];
      document.getElementById('articleListHeader').innerHTML = '<h2>选择一位博主</h2>';
      document.getElementById('topBar').style.display = 'none';
      document.getElementById('articleListBody').innerHTML = '<div class="empty-hint">👈 在左侧选择博主或主题开始浏览</div>';
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
  // Get current topic assignments for this blogger
  let assigned = [];
  try {
    const b = await api.get(`/api/bloggers/${bloggerId}`);
    // We need to get topics for this blogger. Let's check by looking through all topics
  } catch {}
  // Simple approach: fetch all topics and check
  const btResponse = state.topics;
  list.innerHTML = btResponse.map(t => {
    return `<div class="tag-option" data-topic-id="${t.id}" onclick="this.classList.toggle('checked')">
      <div class="tag-check">✓</div>
      <span>${t.icon||'📌'}</span>
      <span>${esc(t.name)}</span>
    </div>`;
  }).join('');

  const rect = e.target.getBoundingClientRect();
  pop.style.top = rect.bottom + 4 + 'px';
  pop.style.left = Math.min(rect.left, innerWidth - 220) + 'px';
  pop.dataset.bloggerId = bloggerId;
  pop.classList.add('show');

  // Check existing assignments
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

// Save tag assignments when popover closes
document.getElementById('tagPopover').addEventListener('mouseleave', async function() {
  // We'll save on click-outside
});

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
    document.getElementById('articleListHeader').innerHTML = '<h2>选择一位博主</h2>';
    document.getElementById('topBar').style.display = 'none';
    document.getElementById('articleListBody').innerHTML = '<div class="empty-hint">👈 在左侧选择博主或主题开始浏览</div>';
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

  document.getElementById('modalTitle').textContent = '编辑主题';
  document.getElementById('topicNameInput').value = topic.name;
  modal.dataset.topicId = topicId;
  modal.classList.add('show');

  // Render chip bloggers
  renderChipBloggers(topicId);
}

async function renderChipBloggers(topicId) {
  const wrap = document.getElementById('chipWrap');
  const input = document.getElementById('chipSearch');
  // Clear existing chips
  wrap.querySelectorAll('.chip').forEach(c => c.remove());

  // Get current bloggers in this topic
  try {
    const r = await api.get(`/api/topics/${topicId}`);
    if (r.bloggers) {
      r.bloggers.forEach(b => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.innerHTML = `${esc(b.name)} <button class="chip-remove" data-blogger-id="${b.id}">✕</button>`;
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
  // Show bloggers not already chipped
  const chippedIds = [...document.querySelectorAll('.chip-remove')].map(b => Number(b.dataset.bloggerId));
  const available = state.bloggers.filter(b => !chippedIds.includes(b.id) && b.name.toLowerCase().includes(val));

  dd.innerHTML = available.map(b => `
    <div class="chip-dropdown-item" data-blogger-id="${b.id}">
      <div class="dd-avatar" style="background:${b.avatar_color||'#ccc'};">${b.name.charAt(0)}</div>
      <span class="dd-name">${esc(b.name)}</span>
      <span class="dd-channels">${esc(b.channel_type)}</span>
    </div>
  `).join('') || '<div class="chip-dropdown-item"><span style="color:#ccc;">无匹配博主</span></div>';
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
  chip.innerHTML = `${esc(b.name)} <button class="chip-remove" data-blogger-id="${b.id}">✕</button>`;
  wrap.insertBefore(chip, input);
  input.value = '';
  this.classList.remove('show');
});

// Chip remove delegation
document.getElementById('chipWrap').addEventListener('click', function(e) {
  if (e.target.classList.contains('chip-remove')) {
    e.target.parentElement.remove();
  }
});

// Topic modal save (handles create and edit)
document.querySelector('#topicModal .modal-btn.primary').addEventListener('click', async () => {
  const modal = document.getElementById('topicModal');
  const topicId = modal.dataset.topicId;
  const name = document.getElementById('topicNameInput').value.trim();
  if (!name) return;
  const bloggerIds = [...document.querySelectorAll('#chipWrap .chip-remove')].map(b => Number(b.dataset.bloggerId));

  if (topicId) {
    await api.put('/api/topics/' + topicId, { name, blogger_ids: bloggerIds });
  } else {
    await api.post('/api/topics', { name, icon: '📌', blogger_ids: bloggerIds });
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

// ===== Delete topic =====
function confirmDeleteTopic(e, topicId, name) {
  e.stopPropagation();
  if (!confirm(`确定删除主题「${name}」？\n博主不会被取消关注。`)) return;
  api.del(`/api/topics/${topicId}`).then(() => {
    loadTopics();
    renderSidebar();
  });
}

// ===== Add blogger modal =====
const addModal = document.getElementById('addModal');
let validChannelId = null;
let validChannelName = null;

document.getElementById('addBtn').addEventListener('click', () => {
  if (state.dimension === 'topic') {
    // New topic
    document.getElementById('modalTitle').textContent = '新建主题';
    document.getElementById('topicNameInput').value = '';
    document.getElementById('chipWrap').querySelectorAll('.chip').forEach(c => c.remove());
    delete document.getElementById('topicModal').dataset.topicId;
    document.getElementById('topicModal').classList.add('show');
  } else {
    // Add blogger
    validChannelId = null;
    validChannelName = null;
    document.getElementById('addUrlInput').value = '';
    document.getElementById('validateResult').textContent = '';
    document.getElementById('validateResult').className = '';
    document.getElementById('confirmAddBtn').disabled = true;
    addModal.classList.add('show');
  }
});

document.querySelector('#addModal .modal-close').addEventListener('click', () => addModal.classList.remove('show'));
document.querySelector('#addModal .modal-btn.secondary').addEventListener('click', () => addModal.classList.remove('show'));

document.getElementById('validateBtn').addEventListener('click', async () => {
  const input = document.getElementById('addUrlInput').value.trim();
  if (!input) return;
  const result = document.getElementById('validateResult');
  result.textContent = '验证中...';
  result.className = '';

  try {
    const data = await api.post('/api/fetch/validate', { channel_type: 'youtube', channel_input: input });
    if (data.valid) {
      validChannelId = data.channel_id;
      validChannelName = data.channel_name;
      result.textContent = `✅ 找到频道：${data.channel_name}`;
      result.className = 'success';
      document.getElementById('confirmAddBtn').disabled = false;
    }
  } catch (err) {
    result.textContent = `❌ ${err.message}`;
    result.className = 'error';
    document.getElementById('confirmAddBtn').disabled = true;
  }
});

document.getElementById('confirmAddBtn').addEventListener('click', async () => {
  if (!validChannelId) return;
  try {
    const data = await api.post('/api/bloggers', {
      name: validChannelName,
      channel_type: 'youtube',
      channel_id: validChannelId,
    });
    addModal.classList.remove('show');
    // Trigger a fetch for this blogger
    try { await api.post(`/api/fetch/${data.id}`); } catch {}
    await loadBloggers();
    renderSidebar();
  } catch (err) {
    document.getElementById('validateResult').textContent = `❌ ${err.message}`;
    document.getElementById('validateResult').className = 'error';
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
  // Close unfollow tooltip
  const tip = document.getElementById('unfollowTooltip');
  if (tip.classList.contains('show') && !tip.contains(e.target) && !e.target.classList.contains('del-btn')) {
    tip.classList.remove('show');
    state.pendingBloggerId = null;
  }

  // Close chip dropdown
  const dd = document.getElementById('chipDropdown');
  const chipWrap = document.getElementById('chipWrap');
  if (dd.classList.contains('show') && !chipWrap.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('show');
  }
});

// Close modals on overlay click
document.getElementById('topicModal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('show');
});
addModal.addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('show');
});

// Enter key for add URL input
document.getElementById('addUrlInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('validateBtn').click();
});

// ===== Helpers =====
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function extractVideoId(url) {
  const patterns = [/v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /embed\/([\w-]{11})/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff/60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}小时前`;
  if (diff < 604800) return `${Math.floor(diff/86400)}天前`;
  return then.toLocaleDateString('zh-CN');
}

// ===== Start =====
init();
