import { renderSummary } from './summary-renderer.js';

const CHANNELS = {
  youtube: { label: 'YouTube', placeholder: '频道链接、@handle 或 UC… 频道 ID' },
  xiaohongshu: { label: '小红书', placeholder: '博主主页链接或用户 ID' },
  douyin: { label: '抖音', placeholder: '博主主页链接或抖音号' },
  wechat: { label: '公众号', placeholder: '公众号名称或微信号' },
};
const CHANNEL_ALIASES = { youtube:'youtube', xiaohongshu:'xiaohongshu', xhs:'xiaohongshu', rednote:'xiaohongshu', douyin:'douyin', wechat:'wechat', weixin:'wechat', mp:'wechat', official_account:'wechat' };
const state = {
  dimension:'blogger', bloggers:[], topics:[], currentArticles:[], providers:{},
  selectedBloggerId:null, selectedTopicId:null, selectedArticleId:null, selectedArticle:null,
  summaryAvailable:false, pendingBloggerId:null, selectedChannel:'youtube',
  validChannelId:null, validChannelName:null, listRequest:0, listController:null,
  fetchPolling:null, fetchFailures:[], fetchRunning:false, fetchTaskId:null,
  summaryRequest:0, summaryGenerating:false, summaryReturnFocus:null,
};

const api = {
  async request(path, options={}) {
    const response = await fetch(path, options);
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(errorMessage(data.error) || data.message || response.statusText || `HTTP ${response.status}`);
    return { data, status:response.status };
  },
  async get(path, signal) { return (await this.request(path, { signal })).data; },
  async post(path, data) { return this.request(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data || {}) }); },
  async put(path, data) { return (await this.request(path, { method:'PUT', headers:data ? {'Content-Type':'application/json'}:{}, body:data ? JSON.stringify(data):undefined })).data; },
  async del(path) { return (await this.request(path, { method:'DELETE' })).data; },
};

async function init() {
  try {
    const config = await api.get('/api/config');
    state.summaryAvailable = Boolean(config.summaryAvailable ?? config.summary_available);
    state.providers = normalizeProviders(config.providers);
  } catch (error) {
    state.providers = normalizeProviders(null);
    showToast(`读取配置失败：${error.message}`, true);
  }
  renderChannels();
  updateSummaryAvailability();
  try {
    await Promise.all([loadBloggers(), loadTopics(), loadFetchStatus()]);
    renderSidebar();
  } catch (error) { showToast(`加载失败：${error.message}`, true); }
}

function normalizeProviders(input) {
  const result = {};
  Object.keys(CHANNELS).forEach(key => { result[key] = { available:key === 'youtube', reason:'' }; });
  if (!input) return result;
  const setValue = (rawKey, rawValue) => {
    const key = CHANNEL_ALIASES[String(rawKey).toLowerCase()];
    if (!key) return;
    const available = typeof rawValue === 'boolean' ? rawValue : Boolean(rawValue?.available ?? rawValue?.enabled ?? rawValue?.configured ?? rawValue?.ready);
    result[key] = { available, reason:typeof rawValue === 'object' ? (rawValue.reason || rawValue.message || '') : '' };
  };
  if (Array.isArray(input)) input.forEach(item => typeof item === 'string' ? setValue(item, true) : setValue(item.id || item.type || item.name, item));
  else Object.entries(input).forEach(([key,value]) => setValue(key,value));
  return result;
}

async function loadBloggers() { state.bloggers = await api.get('/api/bloggers'); }
async function loadTopics() { state.topics = await api.get('/api/topics'); }

function renderSidebar() {
  const container = document.getElementById('sidebarList');
  const query = document.getElementById('sidebarSearch').value.trim().toLowerCase();
  if (state.dimension === 'blogger') {
    const list = state.bloggers.filter(b => !query || String(b.name || '').toLowerCase().includes(query));
    const fresh = list.filter(b => Number(b.unread_count) > 0);
    const read = list.filter(b => Number(b.unread_count) <= 0);
    container.innerHTML = `${fresh.length ? '<div class="list-group-label">NEW / 有新内容</div>' : ''}${fresh.map(renderBloggerItem).join('')}${read.length ? '<div class="list-group-label">CLEAR / 已读完</div>' : ''}${read.map(renderBloggerItem).join('')}${list.length ? '' : '<div class="empty-hint">没有匹配的博主</div>'}`;
  } else {
    const list = state.topics.filter(t => !query || String(t.name || '').toLowerCase().includes(query));
    container.innerHTML = `<div class="list-group-label">TOPICS / 我的主题</div>${list.map(renderTopicItem).join('')}${list.length ? '' : '<div class="empty-hint">暂无主题</div>'}`;
  }
  const selected = state.dimension === 'blogger' ? `[data-blogger-id="${state.selectedBloggerId}"]` : `[data-topic-id="${state.selectedTopicId}"]`;
  if ((state.selectedBloggerId || state.selectedTopicId) && container.querySelector(selected)) container.querySelector(selected).classList.add('active');
}

function renderBloggerItem(blogger) {
  const id = Number(blogger.id);
  const name = String(blogger.name || '未命名');
  const initial = esc(name.charAt(0).toUpperCase());
  const avatar = safeHttpUrl(blogger.avatar_url);
  const avatarHtml = avatar ? `<img class="list-avatar" src="${escAttr(avatar)}" alt=""><span class="list-avatar avatar-fallback" hidden>${initial}</span>` : `<span class="list-avatar">${initial}</span>`;
  const badge = Number(blogger.unread_count) > 0 ? `<span class="avatar-badge">${Math.min(Number(blogger.unread_count),999)}</span>` : '';
  return `<div class="list-item" data-blogger-id="${id}" tabindex="0"><div class="avatar-wrap">${avatarHtml}${badge}</div><div class="list-info"><div class="list-name">${esc(name)}</div><div class="list-meta">${esc(channelLabel(blogger.channel_type))}</div></div><div class="hover-actions"><button class="act-btn tag-btn" data-action="tag" title="归入主题" aria-label="归入主题">＋</button><button class="act-btn del-btn" data-action="unfollow" title="取消关注" aria-label="取消关注">×</button></div></div>`;
}
function renderTopicItem(topic) {
  const id = Number(topic.id);
  const badge = Number(topic.unread_count) > 0 ? `<span class="topic-badge">${Math.min(Number(topic.unread_count),999)}</span>` : '';
  return `<div class="list-item" data-topic-id="${id}" tabindex="0"><div class="topic-icon-wrap"><span class="list-topic-icon">T</span>${badge}</div><div class="list-info"><div class="list-name">${esc(topic.name)}</div><div class="list-meta">${Number(topic.blogger_count)||0} 位博主</div></div><div class="hover-actions"><button class="act-btn" data-action="edit-topic" title="编辑主题">/</button><button class="act-btn del-btn" data-action="delete-topic" title="删除主题">×</button></div></div>`;
}

async function selectBlogger(id) {
  const blogger = state.bloggers.find(item => Number(item.id) === Number(id));
  if (!blogger) return;
  setDimension('blogger', false);
  state.selectedBloggerId = Number(id); state.selectedTopicId = null; resetArticleSelection(); renderSidebar();
  await loadArticleSelection(`/api/articles?blogger_id=${encodeURIComponent(id)}`, { name:blogger.name, type:'blogger', channelType:blogger.channel_type });
}
async function selectTopic(id) {
  const topic = state.topics.find(item => Number(item.id) === Number(id));
  if (!topic) return;
  setDimension('topic', false);
  state.selectedTopicId = Number(id); state.selectedBloggerId = null; resetArticleSelection(); renderSidebar();
  await loadArticleSelection(`/api/articles?topic_id=${encodeURIComponent(id)}`, { name:topic.name, type:'topic' });
}
async function loadArticleSelection(path, source) {
  const serial = ++state.listRequest;
  state.listController?.abort(); state.listController = new AbortController();
  document.getElementById('articleListBody').innerHTML = '<div class="empty-hint">正在对焦…</div>';
  try {
    const articles = await api.get(path, state.listController.signal);
    if (serial !== state.listRequest) return;
    state.currentArticles = Array.isArray(articles) ? articles : (articles.articles || []);
    renderArticleList(state.currentArticles, source);
    clearContent();
  } catch (error) {
    if (error.name === 'AbortError' || serial !== state.listRequest) return;
    document.getElementById('articleListBody').innerHTML = `<div class="empty-hint">加载失败：${esc(error.message)}</div>`;
  }
}
function resetArticleSelection() { state.selectedArticleId=null; state.selectedArticle=null; state.currentArticles=[]; clearContent(); }

function renderArticleList(articles, source=getCurrentSource()) {
  const header = document.getElementById('articleListHeader');
  header.innerHTML = source ? `<div><span class="eyebrow">${source.type === 'topic' ? 'TOPIC' : 'TARGET'}</span><h2>${esc(source.name)}</h2></div>${source.channelType ? `<span class="channel-tag">${esc(channelLabel(source.channelType))}</span>` : ''}` : '<div><span class="eyebrow">FOCUS</span><h2>选择一位博主</h2></div>';
  const topBar = document.getElementById('topBar');
  const unread = articles.filter(a => !a.is_read).length;
  document.getElementById('topStats').innerHTML = articles.length ? `<span><b class="stat-num">${unread}</b> 条未读</span>${articles[0]?.published_at ? `<span>最近 ${esc(timeAgo(articles[0].published_at))}</span>` : ''}` : '';
  topBar.hidden = !articles.length;
  document.getElementById('readAllBtn').hidden = source?.type !== 'blogger';
  const body = document.getElementById('articleListBody');
  if (!articles.length) { body.innerHTML='<div class="empty-hint">尚未抓取到内容</div>'; return; }
  // 主题视图按更新时间分组（今日/昨日/更早）做信息流展示；博主视图保持平铺。
  const grouped = source?.type === 'topic';
  let lastBucket = null;
  body.innerHTML = articles.map(article => {
    let header = '';
    if (grouped) {
      const bucket = dateBucket(article.published_at);
      if (bucket !== lastBucket) { header = `<div class="article-group-label">${bucket}</div>`; lastBucket = bucket; }
    }
    return header + renderArticleItem(article);
  }).join('');
}
function renderArticleItem(article) {
  const title = article.title_cn || article.title || '无标题';
  const snippet = String(article.summary_cn || article.summary || article.description || '').slice(0,120);
  const active = Number(article.id) === Number(state.selectedArticleId) ? ' active' : '';
  return `<div class="article-item${article.is_read ? '' : ' unread'}${active}" data-article-id="${Number(article.id)}" tabindex="0"><div class="article-title">${esc(title)}</div>${snippet ? `<div class="article-snippet">${esc(snippet)}</div>` : ''}<div class="article-meta"><span class="meta-author">${esc(article.blogger_name || '')}</span><span>${esc(channelLabel(article.channel_type))}</span><span>${article.published_at ? esc(timeAgo(article.published_at)) : ''}</span></div></div>`;
}
function dateBucket(value) {
  const date = parseDate(value);
  if (!date) return '更早';
  const now = new Date();
  // 本自然周（周一至周日）：本周一 0 点及之后归“本周更新”，更早的按具体日期分组。
  const day = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1));
  if (new Date(date.getFullYear(), date.getMonth(), date.getDate()) >= monday) return '本周更新';
  return date.toLocaleDateString('zh-CN');
}

async function selectArticle(id) {
  const article = state.currentArticles.find(item => Number(item.id) === Number(id));
  if (!article) return;
  state.selectedArticleId=Number(id); state.selectedArticle=article;
  document.querySelectorAll('.article-item').forEach(item => item.classList.toggle('active', Number(item.dataset.articleId) === Number(id)));
  renderContent(article);
  if (!article.is_read) {
    try {
      await api.put(`/api/articles/${encodeURIComponent(id)}/read`);
      article.is_read=1;
      await Promise.all([loadBloggers(), loadTopics()]);
      renderSidebar(); renderArticleList(state.currentArticles, getCurrentSource());
    } catch (error) { showToast(`标记已读失败：${error.message}`, true); }
  }
}
function renderContent(article) {
  const header = document.getElementById('contentHeader'); header.hidden=false;
  document.getElementById('sourceIcon').textContent=channelLabel(article.channel_type);
  const date = parseDate(article.published_at);
  document.getElementById('pubTime').textContent=date ? `${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}` : '';
  const origin = document.getElementById('originBtn'); const safeUrl=safeHttpUrl(article.url);
  origin.hidden=!safeUrl; if (safeUrl) origin.href=safeUrl; else origin.removeAttribute('href');
  const isWechat = normalizeChannel(article.channel_type) === 'wechat';
  updateSummaryAvailability(!isWechat);
  const titleText = article.title_cn || article.title || '无标题';
  const titleSize = titleText.length > 40 ? ' title-sm' : titleText.length > 24 ? ' title-md' : '';
  let html=`<h1 class="article-title${titleSize}">${esc(titleText)}</h1>`;
  if (article.title_cn && article.title && article.title_cn !== article.title) html += `<div class="original-title">${esc(article.title)}</div>`;
  if (normalizeChannel(article.channel_type) === 'youtube' && safeUrl) {
    const videoId=extractVideoId(safeUrl); if (videoId) html += `<div class="video-wrap"><iframe src="https://www.youtube.com/embed/${escAttr(videoId)}" title="YouTube 视频" loading="lazy" allowfullscreen></iframe></div>`;
  }
  if (isWechat) {
    html += '<details class="detail-block" open><summary>AI 摘要</summary><div class="block-body"><div id="inlineSummary"><div class="loading-spinner">正在生成摘要…</div></div></div></details>';
    html += '<div id="inlineContent" class="inline-content"><div class="loading-spinner">正在加载正文…</div></div>';
    document.getElementById('contentBody').innerHTML=html;
    loadWechatDetail(article);
  } else {
    const description=article.summary_cn || article.summary || article.description || article.content;
    if (description) html += `<div class="desc">${esc(description)}</div>`;
    else html += '<div class="desc">暂无文字摘要，请查看原文。</div>';
    document.getElementById('contentBody').innerHTML=html;
  }
}
async function loadWechatDetail(article) {
  const articleId = Number(article.id);
  const serial = state.listRequest;
  const contentPromise = api.post(`/api/articles/${articleId}/content`).then(r => r.data).catch(err => ({ error: err.message }));
  const summaryPromise = state.summaryAvailable
    ? api.post(`/api/articles/${articleId}/summary`).then(r => r.data).catch(err => ({ error: err.message }))
    : Promise.resolve({ error: '摘要服务未配置' });
  contentPromise.then(result => {
    if (serial !== state.listRequest || Number(state.selectedArticleId) !== articleId) return;
    const container = document.getElementById('inlineContent');
    if (!container) return;
    const wrapBody = (bodyHtml, open) => `<details class="detail-block"${open ? ' open' : ''}><summary>原文正文</summary><div class="block-body">${bodyHtml}</div></details>`;
    if (result.error) {
      const desc = article.summary_cn || article.summary || article.description || '';
      container.innerHTML = wrapBody(`${desc ? `<div class="desc">${esc(desc)}</div>` : ''}<div class="content-fallback">正文加载失败：${esc(result.error)}</div>`, true);
    } else if (result.content) {
      const chars = result.content.replace(/\s/g, '').length;
      const minutes = Math.max(1, Math.round(chars / 400));
      const meta = `<div class="content-meta">全文共 ${chars} 字 · 阅读约 ${minutes} 分钟</div>`;
      const end = '<div class="content-end">— 全文完 —</div>';
      container.innerHTML = wrapBody(`${meta}<div class="article-content">${formatContent(result.content)}</div>${end}`, false);
    } else {
      const desc = article.summary_cn || article.summary || article.description || '';
      container.innerHTML = wrapBody(desc ? `<div class="desc">${esc(desc)}</div>` : '<div class="desc">暂无正文内容</div>', true);
    }
  });
  summaryPromise.then(result => {
    if (serial !== state.listRequest || Number(state.selectedArticleId) !== articleId) return;
    const container = document.getElementById('inlineSummary');
    if (!container) return;
    if (result.error) {
      container.innerHTML = `<div class="summary-fallback">摘要生成失败：${esc(result.error)}</div>`;
    } else if (result.summary) {
      renderSummary(container, result.summary);
    } else {
      container.innerHTML = '<div class="summary-fallback">摘要为空</div>';
    }
  });
}
function formatContent(text) {
  return String(text || '')
    .split(/\n{2,}|\s{3,}|　{2,}/)
    .map(para => para.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph)
    .map(para => `<p>${esc(para)}</p>`)
    .join('');
}
// 微信正文里作者常把多句话用逗号连成一大段。对超长段落在句末标点（。！？）后切分，
// 提高可读性；单个长句（内部只有逗号）不强行拆开。
function splitLongParagraph(para) {
  if (para.length <= 100) return [para];
  const sentences = para.match(/[^。！？]*[。！？]+|[^。！？]+$/g) || [para];
  const chunks = [];
  let buffer = '';
  for (const sentence of sentences) {
    buffer += sentence;
    if (buffer.length >= 60) { chunks.push(buffer); buffer = ''; }
  }
  if (buffer) chunks.push(buffer);
  return chunks.length ? chunks : [para];
}
function clearContent() {
  document.getElementById('contentHeader').hidden=true;
  document.getElementById('contentBody').innerHTML='<div class="empty-hint content-empty"><svg class="crosshair large" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="9"/><path d="M20 2v9M20 29v9M2 20h9M29 20h9"/><circle class="target-dot" cx="20" cy="20" r="2"/></svg><strong>等待锁定内容</strong><span>选择一篇文章开始阅读</span></div>';
}
function getCurrentSource() {
  if (state.selectedBloggerId) { const b=state.bloggers.find(x => Number(x.id)===Number(state.selectedBloggerId)); return b ? {name:b.name,type:'blogger',channelType:b.channel_type}:null; }
  if (state.selectedTopicId) { const t=state.topics.find(x => Number(x.id)===Number(state.selectedTopicId)); return t ? {name:t.name,type:'topic'}:null; }
  return null;
}

function setDimension(dimension, clearIfEmpty=true) {
  state.dimension=dimension;
  document.querySelectorAll('.dim-tab').forEach(tab => tab.classList.toggle('active',tab.dataset.dim===dimension));
  document.getElementById('addBtn').textContent=dimension==='blogger'?'添加博主':'新建主题'; renderSidebar();
  if (!clearIfEmpty) return;
  if (dimension==='blogger' && state.selectedBloggerId) selectBlogger(state.selectedBloggerId);
  else if (dimension==='topic' && state.selectedTopicId) selectTopic(state.selectedTopicId);
  else { state.listController?.abort(); resetArticleSelection(); renderArticleList([],null); }
}

async function generateSummary() {
  if (!state.summaryAvailable || !state.selectedArticleId || state.summaryGenerating) return;
  const articleId=state.selectedArticleId; const requestId=++state.summaryRequest;
  const overlay=document.getElementById('summaryOverlay'); const content=document.getElementById('summaryContent');
  const button=document.getElementById('summaryBtn'); state.summaryReturnFocus=document.activeElement;
  state.summaryGenerating=true; updateSummaryAvailability();
  overlay.classList.add('show'); overlay.hidden=false;
  content.replaceChildren(createStatusNode('loading-spinner','正在按长文萃取规则分析，可能需要几十秒…'));
  document.getElementById('summaryClose').focus();
  try {
    const {data}=await api.post(`/api/articles/${articleId}/summary`);
    if (requestId!==state.summaryRequest || !overlay.classList.contains('show')) return;
    renderSummary(content,data.summary || '');
  } catch(error) {
    if (requestId!==state.summaryRequest || !overlay.classList.contains('show')) return;
    content.replaceChildren(createStatusNode('summary-error',`生成失败：${error.message}`));
  } finally {
    if (requestId===state.summaryRequest) { state.summaryGenerating=false; updateSummaryAvailability(); }
    button.removeAttribute('aria-busy');
  }
}
function createStatusNode(className,text) { const node=document.createElement('div'); node.className=className; node.textContent=text; return node; }
function updateSummaryAvailability(showButton=true) {
  const button=document.getElementById('summaryBtn');
  button.hidden=!showButton;
  if (!showButton) return;
  const disabled=!state.summaryAvailable || state.summaryGenerating;
  button.classList.toggle('disabled',disabled); button.disabled=disabled;
  button.textContent=state.summaryGenerating?'萃取中…':'生成摘要';
  button.title=state.summaryAvailable?'采用长文萃取规则生成':'需要配置摘要服务';
  if (state.summaryGenerating) button.setAttribute('aria-busy','true'); else button.removeAttribute('aria-busy');
}

async function loadFetchStatus() {
  try {
    const status=await api.get('/api/fetch/status');
    renderFetchState(status);
    const active=(status.tasks||[]).find(isFetchPending);
    if(active){ state.fetchTaskId=active.id; startFetchPolling(active.id); }
  } catch(error) { document.getElementById('lastFetchText').textContent='状态不可用'; }
}
async function startGlobalFetch() {
  if (state.fetchRunning) return;
  setFetchRunning(true); state.fetchFailures=[]; renderFetchFailures([]); setFetchMessage('更新任务已提交');
  try {
    const {data,status}=await api.post('/api/fetch',{});
    state.fetchTaskId=data.task_id || data.id || null;
    if (status===202 || isFetchPending(data)) { renderFetchState(data); startFetchPolling(state.fetchTaskId); }
    else { finishFetch(data); }
  } catch(error) { setFetchRunning(false); setFetchMessage(`更新失败：${error.message}`,true); renderFetchFailures([{name:'全部来源',error:error.message}]); }
}
function startFetchPolling(taskId=state.fetchTaskId) {
  clearInterval(state.fetchPolling); setFetchRunning(true); state.fetchTaskId=taskId;
  const poll=async()=>{ try {
    const payload=taskId ? await api.get(`/api/fetch/status/${encodeURIComponent(taskId)}`) : await api.get('/api/fetch/status');
    renderFetchState(payload);
    if (!isFetchPending(payload)) { clearInterval(state.fetchPolling); state.fetchPolling=null; state.fetchTaskId=null; finishFetch(payload); }
  } catch(error){ clearInterval(state.fetchPolling); state.fetchPolling=null; state.fetchTaskId=null; setFetchRunning(false); setFetchMessage(`读取进度失败：${error.message}`,true); } };
  state.fetchPolling=setInterval(poll,1200); poll();
}
function renderFetchState(payload={}) {
  const status=payload.job || payload.task || payload;
  const bloggers=Array.isArray(status.bloggers)?status.bloggers:[];
  const total=Number(status.total ?? status.total_count ?? status.blogger_count ?? bloggers.length ?? 0);
  const completed=Number(status.completed ?? status.done ?? status.processed ?? bloggers.filter(b=>['success','failed'].includes(b.last_fetch_status)).length);
  const percent=Number(status.progress ?? (total ? completed/total*100 : (isFetchPending(status)?8:0)));
  const running=isFetchPending(status) || Number(status.running_count)>0; setFetchRunning(running);
  document.getElementById('fetchProgressBar').style.width=`${Math.max(0,Math.min(100,percent))}%`;
  if (running) setFetchMessage(`更新中 ${completed}${total ? ` / ${total}`:''}${status.current ? ` · ${status.current}`:''}`);
  const last=status.last_fetch || status.lastFetch || status.finished_at || status.completed_at;
  if (last) document.getElementById('lastFetchText').textContent=`最近更新 ${timeAgo(last)}`;
  const failures=extractFailures(status); if (failures.length) { state.fetchFailures=failures; renderFetchFailures(failures); }
}
async function finishFetch(payload={}) {
  setFetchRunning(false); renderFetchState({...payload,status:'completed'});
  const failures=extractFailures(payload); state.fetchFailures=failures; renderFetchFailures(failures);
  const results=Array.isArray(payload.results)?payload.results:[];
  const success=results.length ? results.filter(r => r.success !== false).length : Number(payload.success_count ?? payload.succeeded ?? 0);
  setFetchMessage(failures.length ? `更新完成，${failures.length} 个来源失败` : `更新完成${success ? `，${success} 个来源成功`:''}`,Boolean(failures.length));
  await refreshAfterFetch();
}
function extractFailures(payload={}) {
  const taskResults=Array.isArray(payload.result)?payload.result:[];
  const bloggerFailures=Array.isArray(payload.bloggers)?payload.bloggers.filter(item=>item.last_fetch_status==='failed'):[];
  const raw=payload.failures || payload.errors || bloggerFailures || [];
  const combined=[...(Array.isArray(raw)?raw:[]),...taskResults.filter(item=>item.success===false)];
  if(payload.status==='failed' && payload.error) combined.push({blogger_id:payload.blogger_id,error:payload.error});
  const seen=new Set();
  return combined.map(item => ({ id:item.blogger_id ?? item.id, name:item.blogger_name || item.blogger || item.name || item.channel || '未知来源', error:errorMessage(item.last_fetch_error || item.error || item.message || item.reason) || '更新失败' })).filter(item=>{const key=`${item.id}:${item.error}`;if(seen.has(key))return false;seen.add(key);return true;});
}
function renderFetchFailures(failures) {
  const box=document.getElementById('fetchErrors'); box.hidden=!failures.length;
  box.innerHTML=failures.map((item,index)=>`<div class="fetch-error-row"><span>${esc(item.name)}：${esc(item.error)}</span><button class="retry-btn" data-retry-index="${index}">重试</button></div>`).join('');
}
async function retryFetch(index) {
  const failure=state.fetchFailures[index]; if (!failure) return;
  if (!failure.id) return startGlobalFetch();
  setFetchMessage(`正在重试 ${failure.name}`); setFetchRunning(true);
  try { const {data,status}=await api.post(`/api/fetch/${encodeURIComponent(failure.id)}`,{}); state.fetchTaskId=data.task_id||data.id||null; if(status===202||isFetchPending(data)) startFetchPolling(state.fetchTaskId); else await finishFetch(data); }
  catch(error){ setFetchRunning(false); setFetchMessage(`重试失败：${error.message}`,true); }
}
function isFetchPending(payload={}) { const value=String((payload.job||payload.task||payload).status || '').toLowerCase(); return ['queued','pending','running','processing','fetching','in_progress'].includes(value) || payload.running===true; }
function setFetchRunning(running) { state.fetchRunning=running; const button=document.getElementById('fetchAllBtn'); button.disabled=running; button.textContent=running?'更新中…':'更新全部'; document.getElementById('fetchProgress').hidden=!running; if(!running) document.getElementById('fetchProgressBar').style.width='100%'; }
function setFetchMessage(message,isError=false) { const el=document.getElementById('fetchStatus'); el.textContent=message; el.style.color=isError?'var(--red)':''; }
async function refreshAfterFetch() { await Promise.all([loadBloggers(),loadTopics()]); renderSidebar(); if(state.selectedBloggerId) await selectBlogger(state.selectedBloggerId); else if(state.selectedTopicId) await selectTopic(state.selectedTopicId); }

function renderChannels() {
  const container=document.getElementById('channelSelect');
  container.innerHTML=Object.entries(CHANNELS).map(([key,channel])=>{ const provider=state.providers[key] || {available:false}; return `<button type="button" class="channel-option${state.selectedChannel===key && provider.available?' active':''}${provider.available?'':' disabled'}" data-channel="${key}" ${provider.available?'':'disabled'}><span>${esc(channel.label)}</span><small>${provider.available?'可用':`待配置${provider.reason?` · ${esc(provider.reason)}`:''}`}</small>${provider.available?'<i class="provider-mark"></i>':''}</button>`; }).join('');
  if (!state.providers[state.selectedChannel]?.available) state.selectedChannel=Object.keys(CHANNELS).find(key=>state.providers[key]?.available) || 'youtube';
  container.querySelectorAll('.channel-option').forEach(option=>option.classList.toggle('active',option.dataset.channel===state.selectedChannel && !option.disabled));
  updateAddPlaceholder();
}
function updateAddPlaceholder() { const channel=CHANNELS[state.selectedChannel]; document.getElementById('addUrlInput').placeholder=channel?.placeholder || '主页链接或账号 ID'; }
function resetAddModal() { state.validChannelId=null; state.validChannelName=null; document.getElementById('addUrlInput').value=''; document.getElementById('validateResult').textContent=''; document.getElementById('validateResult').className=''; document.getElementById('confirmAddBtn').disabled=true; renderChannels(); }
async function validateChannel() {
  const input=document.getElementById('addUrlInput').value.trim(); if(!input)return;
  const result=document.getElementById('validateResult'); result.textContent='正在验证…'; result.className=''; document.getElementById('confirmAddBtn').disabled=true;
  try { const {data}=await api.post('/api/fetch/validate',{channel_type:state.selectedChannel,channel_input:input}); if(!data.valid) throw new Error(data.error||'未通过验证'); state.validChannelId=data.channel_id || data.account_id || data.id || input; state.validChannelName=data.channel_name || data.account_name || data.name || input; result.textContent=`已找到：${state.validChannelName}`; result.className='success'; document.getElementById('confirmAddBtn').disabled=false; }
  catch(error){ state.validChannelId=null; result.textContent=error.message; result.className='error'; }
}
async function confirmAddBlogger() {
  if(!state.validChannelId)return; const result=document.getElementById('validateResult');
  try {
    const {data}=await api.post('/api/bloggers',{name:state.validChannelName,channel_type:state.selectedChannel,channel_id:state.validChannelId});
    document.getElementById('addModal').classList.remove('show'); await loadBloggers(); renderSidebar();
    try { const response=await api.post(`/api/fetch/${encodeURIComponent(data.id)}`,{}); state.fetchTaskId=response.data.task_id||response.data.id||null; if(response.status===202||isFetchPending(response.data)) startFetchPolling(state.fetchTaskId); else await finishFetch(response.data); }
    catch(error){ setFetchMessage(`首次抓取失败：${error.message}`,true); renderFetchFailures([{id:data.id,name:data.name||state.validChannelName,error:error.message}]); showToast(`已添加，但首次抓取失败：${error.message}`,true); }
  } catch(error){ result.textContent=error.message; result.className='error'; }
}

async function showTagPopover(button,bloggerId) {
  const pop=document.getElementById('tagPopover'); const list=document.getElementById('tagPopoverList');
  try { await loadTopics(); const existing=await getBloggerTopics(bloggerId); const ids=new Set(existing.map(t=>Number(t.id))); list.innerHTML=state.topics.map(t=>`<div class="tag-option${ids.has(Number(t.id))?' checked':''}" data-topic-id="${Number(t.id)}"><span class="tag-check">✓</span><span>${esc(t.name)}</span></div>`).join('') || '<div class="empty-hint">请先新建主题</div>'; }
  catch(error){ list.innerHTML=`<div class="empty-hint">加载失败：${esc(error.message)}</div>`; }
  const rect=button.getBoundingClientRect(); pop.style.top=`${rect.bottom+4}px`; pop.style.left=`${Math.min(rect.left,innerWidth-230)}px`; pop.dataset.bloggerId=bloggerId; pop.classList.add('show');
}
async function getBloggerTopics(id) { const data=await api.get(`/api/bloggers/${encodeURIComponent(id)}/topics`); return data.topics || []; }
async function closeAndSaveTagPopover(eventTarget) {
  const pop=document.getElementById('tagPopover'); if(!pop.classList.contains('show')||pop.contains(eventTarget)||eventTarget.closest?.('.tag-btn'))return;
  pop.classList.remove('show'); const id=Number(pop.dataset.bloggerId); const topicIds=[...pop.querySelectorAll('.tag-option.checked')].map(el=>Number(el.dataset.topicId));
  try { await api.put(`/api/bloggers/${id}/topics`,{topic_ids:topicIds}); await Promise.all([loadBloggers(),loadTopics()]); renderSidebar(); if(state.selectedTopicId) await selectTopic(state.selectedTopicId); }
  catch(error){ showToast(`主题归类保存失败：${error.message}`,true); }
}
function showUnfollow(button,id,name) { state.pendingBloggerId=id; document.getElementById('unfollowName').textContent=name; const tip=document.getElementById('unfollowTooltip'); const rect=button.getBoundingClientRect(); tip.style.top=`${rect.bottom+4}px`; tip.style.left=`${Math.max(8,Math.min(rect.left-160,innerWidth-230))}px`; tip.classList.add('show'); }
async function confirmUnfollow() {
  const id=state.pendingBloggerId; if(!id)return; document.getElementById('unfollowTooltip').classList.remove('show'); state.pendingBloggerId=null;
  try { const result=await api.del(`/api/bloggers/${id}`); if(Number(state.selectedBloggerId)===Number(id)){state.selectedBloggerId=null;resetArticleSelection();renderArticleList([],null);} await Promise.all([loadBloggers(),loadTopics()]); renderSidebar(); if(state.selectedTopicId) await selectTopic(state.selectedTopicId); showToast(`已删除 ${result.name || '博主'} 及其内容`); }
  catch(error){ showToast(`取消关注失败：${error.message}`,true); }
}

function openTopicModal(topicId=null) { const modal=document.getElementById('topicModal'); const topic=state.topics.find(t=>Number(t.id)===Number(topicId)); document.getElementById('modalTitle').textContent=topic?'编辑主题':'新建主题'; document.getElementById('topicNameInput').value=topic?.name||''; if(topic)modal.dataset.topicId=topic.id;else delete modal.dataset.topicId; modal.classList.add('show'); renderChipBloggers(topic?.id); }
async function renderChipBloggers(topicId) { const wrap=document.getElementById('chipWrap'); const input=document.getElementById('chipSearch'); wrap.querySelectorAll('.chip').forEach(c=>c.remove()); if(!topicId)return; try { const data=await api.get(`/api/topics/${topicId}`); (data.bloggers||[]).forEach(blogger=>wrap.insertBefore(createChip(blogger),input)); } catch(error){showToast(`主题成员加载失败：${error.message}`,true);} }
function createChip(blogger) { const chip=document.createElement('span'); chip.className='chip'; chip.append(document.createTextNode(blogger.name||'')); const remove=document.createElement('button'); remove.className='chip-remove'; remove.dataset.bloggerId=blogger.id; remove.type='button'; remove.textContent='×'; chip.append(remove); return chip; }
function renderChipDropdown(query='') { const chosen=new Set([...document.querySelectorAll('#chipWrap .chip-remove')].map(el=>Number(el.dataset.bloggerId))); const available=state.bloggers.filter(b=>!chosen.has(Number(b.id))&&String(b.name||'').toLowerCase().includes(query.toLowerCase())); const dd=document.getElementById('chipDropdown'); dd.innerHTML=available.map(b=>`<div class="chip-dropdown-item" data-blogger-id="${Number(b.id)}"><span class="dd-avatar">${esc(String(b.name||'').charAt(0))}</span><span>${esc(b.name)}</span><span class="dd-channels">${esc(channelLabel(b.channel_type))}</span></div>`).join('')||'<div class="empty-hint">无匹配博主</div>'; dd.classList.add('show'); }
async function saveTopic() { const modal=document.getElementById('topicModal'); const id=modal.dataset.topicId; const name=document.getElementById('topicNameInput').value.trim(); if(!name)return; const blogger_ids=[...document.querySelectorAll('#chipWrap .chip-remove')].map(el=>Number(el.dataset.bloggerId)); try { if(id)await api.put(`/api/topics/${id}`,{name,blogger_ids});else await api.post('/api/topics',{name,blogger_ids}); modal.classList.remove('show'); await loadTopics(); renderSidebar(); if(id&&Number(state.selectedTopicId)===Number(id))await selectTopic(id); } catch(error){showToast(`保存主题失败：${error.message}`,true);} }
async function deleteTopic(id,name) { if(!confirm(`确定删除主题「${name}」？\n博主不会被取消关注。`))return; try { await api.del(`/api/topics/${id}`); if(Number(state.selectedTopicId)===Number(id)){state.selectedTopicId=null;resetArticleSelection();renderArticleList([],null);} await loadTopics(); renderSidebar(); } catch(error){showToast(`删除主题失败：${error.message}`,true);} }

function bindEvents() {
  document.querySelector('.dimension-tabs').addEventListener('click',e=>{const tab=e.target.closest('.dim-tab');if(tab)setDimension(tab.dataset.dim);});
  document.getElementById('sidebarSearch').addEventListener('input',renderSidebar);
  document.getElementById('sidebarList').addEventListener('click',e=>handleSidebarAction(e));
  document.getElementById('sidebarList').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handleSidebarAction(e);}});
  document.getElementById('articleListBody').addEventListener('click',e=>{const item=e.target.closest('.article-item');if(item)selectArticle(item.dataset.articleId);});
  document.getElementById('articleListBody').addEventListener('keydown',e=>{const item=e.target.closest('.article-item');if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectArticle(item.dataset.articleId);}});
  document.getElementById('readAllBtn').addEventListener('click',async()=>{if(!state.selectedBloggerId)return;try{await api.put(`/api/articles/read-all?blogger_id=${state.selectedBloggerId}`);state.currentArticles.forEach(a=>a.is_read=1);await Promise.all([loadBloggers(),loadTopics()]);renderSidebar();renderArticleList(state.currentArticles,getCurrentSource());}catch(error){showToast(error.message,true);}});
  document.getElementById('fetchAllBtn').addEventListener('click',startGlobalFetch);
  document.getElementById('fetchErrors').addEventListener('click',e=>{const button=e.target.closest('[data-retry-index]');if(button)retryFetch(Number(button.dataset.retryIndex));});
  document.getElementById('summaryBtn').addEventListener('click',generateSummary);
  document.getElementById('summaryClose').addEventListener('click',closeSummary);
  document.getElementById('summaryOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeSummary();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('summaryOverlay').classList.contains('show'))closeSummary();});
  document.getElementById('addBtn').addEventListener('click',()=>{if(state.dimension==='topic')openTopicModal();else{resetAddModal();document.getElementById('addModal').classList.add('show');}});
  document.getElementById('channelSelect').addEventListener('click',e=>{const option=e.target.closest('[data-channel]');if(!option||option.disabled)return;state.selectedChannel=option.dataset.channel;state.validChannelId=null;document.getElementById('confirmAddBtn').disabled=true;renderChannels();});
  document.getElementById('validateBtn').addEventListener('click',validateChannel); document.getElementById('confirmAddBtn').addEventListener('click',confirmAddBlogger);
  document.getElementById('addUrlInput').addEventListener('keydown',e=>{if(e.key==='Enter')validateChannel();});
  document.querySelectorAll('#addModal .modal-close,#addModal .secondary').forEach(button=>button.addEventListener('click',()=>document.getElementById('addModal').classList.remove('show')));
  document.querySelector('#topicModal .primary').addEventListener('click',saveTopic); document.querySelectorAll('#topicModal .modal-close,#topicModal .secondary').forEach(button=>button.addEventListener('click',()=>document.getElementById('topicModal').classList.remove('show')));
  document.getElementById('chipSearch').addEventListener('input',e=>renderChipDropdown(e.target.value)); document.getElementById('chipSearch').addEventListener('focus',e=>renderChipDropdown(e.target.value));
  document.getElementById('chipWrap').addEventListener('click',e=>{if(e.target.matches('.chip-remove'))e.target.parentElement.remove();});
  document.getElementById('chipDropdown').addEventListener('mousedown',e=>{const item=e.target.closest('[data-blogger-id]');if(!item)return;e.preventDefault();const blogger=state.bloggers.find(b=>Number(b.id)===Number(item.dataset.bloggerId));if(blogger)document.getElementById('chipWrap').insertBefore(createChip(blogger),document.getElementById('chipSearch'));document.getElementById('chipSearch').value='';renderChipDropdown('');});
  document.getElementById('tagPopoverList').addEventListener('click',e=>{const option=e.target.closest('.tag-option');if(option)option.classList.toggle('checked');});
  document.querySelector('#unfollowTooltip .btn-cancel').addEventListener('click',()=>{document.getElementById('unfollowTooltip').classList.remove('show');state.pendingBloggerId=null;}); document.querySelector('#unfollowTooltip .btn-confirm').addEventListener('click',confirmUnfollow);
  document.addEventListener('click',e=>{closeAndSaveTagPopover(e.target);const tip=document.getElementById('unfollowTooltip');if(tip.classList.contains('show')&&!tip.contains(e.target)&&!e.target.closest?.('.del-btn')){tip.classList.remove('show');state.pendingBloggerId=null;}if(!e.target.closest?.('#chipWrap,#chipDropdown'))document.getElementById('chipDropdown').classList.remove('show');});
  document.querySelectorAll('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.classList.remove('show');}));
  document.addEventListener('error',e=>{const image=e.target;if(image.matches?.('img.list-avatar')){image.hidden=true;image.nextElementSibling.hidden=false;}},true);
}
function handleSidebarAction(event) { const item=event.target.closest('.list-item');if(!item)return;const action=event.target.closest('[data-action]')?.dataset.action;if(action){event.stopPropagation();if(action==='tag')showTagPopover(event.target,Number(item.dataset.bloggerId));if(action==='unfollow')showUnfollow(event.target,Number(item.dataset.bloggerId),item.querySelector('.list-name').textContent);if(action==='edit-topic')openTopicModal(Number(item.dataset.topicId));if(action==='delete-topic')deleteTopic(Number(item.dataset.topicId),item.querySelector('.list-name').textContent);return;}if(item.dataset.bloggerId)selectBlogger(item.dataset.bloggerId);else selectTopic(item.dataset.topicId); }
function closeSummary(){const overlay=document.getElementById('summaryOverlay');overlay.classList.remove('show');overlay.hidden=true;state.summaryRequest++;state.summaryGenerating=false;updateSummaryAvailability();const focusTarget=state.summaryReturnFocus;state.summaryReturnFocus=null;if(focusTarget?.isConnected&&!focusTarget.disabled)focusTarget.focus();}

function normalizeChannel(type){return CHANNEL_ALIASES[String(type||'').toLowerCase()]||String(type||'').toLowerCase();}
function channelLabel(type){return CHANNELS[normalizeChannel(type)]?.label || type || '未知渠道';}
function errorMessage(value){if(!value)return'';if(typeof value==='string'){try{const parsed=JSON.parse(value);return errorMessage(parsed);}catch{return value;}}return value.message||value.detail||value.code||JSON.stringify(value);}
function safeHttpUrl(value){if(!value)return null;try{const url=new URL(String(value),location.origin);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
function extractVideoId(url){for(const pattern of [/v=([\w-]{11})/,/youtu\.be\/([\w-]{11})/,/embed\/([\w-]{11})/,/shorts\/([\w-]{11})/]){const match=url.match(pattern);if(match)return match[1];}return null;}
function esc(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escAttr(value){return esc(value);}
function parseDate(value){if(!value)return null;const normalized=typeof value==='string'&&!/[zZ]|[+-]\d\d:?\d\d$/.test(value)?`${value.replace(' ','T')}Z`:value;const date=new Date(normalized);return Number.isNaN(date.getTime())?null:date;}
function timeAgo(value){const then=parseDate(value);if(!then)return'未知';const diff=Math.max(0,Math.floor((Date.now()-then.getTime())/1000));if(diff<60)return'刚刚';if(diff<3600)return`${Math.floor(diff/60)} 分钟前`;if(diff<86400)return`${Math.floor(diff/3600)} 小时前`;if(diff<604800)return`${Math.floor(diff/86400)} 天前`;return then.toLocaleDateString('zh-CN');}
let toastTimer;function showToast(message,isError=false){const toast=document.getElementById('toast');toast.textContent=message;toast.classList.toggle('error',isError);toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3500);}

bindEvents();
init();
