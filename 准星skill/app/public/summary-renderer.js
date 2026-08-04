// 三段式摘要渲染：把 DeepSeek 输出的 Markdown（## 核心摘要 / ## 要点论述 / ## 洞见启发）
// 渲染成可折叠区块。每个 ## 小节是一个 <details>，默认展开。

export function renderSummary(container, markdown) {
  container.innerHTML = '';
  const sections = parseSections(markdown);
  if (!sections.length) {
    container.innerHTML = `<div class="summary-fallback">${escapeHtml(String(markdown || '').slice(0, 600))}</div>`;
    return;
  }
  for (const sec of sections) {
    const part = document.createElement('div');
    part.className = 'sum-part';
    part.innerHTML = `<h4 class="sum-part-title">${escapeHtml(sec.title)}</h4><div class="sum-part-body">${sec.html}</div>`;
    container.appendChild(part);
  }
}

// 兼容旧调用名
export const renderLongExtract = renderSummary;

function parseSections(md) {
  const text = String(md || '').replace(/\r/g, '');
  const parts = text.split(/^#{2,}\s+/m).map(s => s.trim()).filter(Boolean);
  return parts.map(part => {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).replace(/[#*]/g, '').trim();
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    return { title, html: renderBody(body) };
  }).filter(sec => sec.title);
}

function renderBody(body) {
  const lines = body.split('\n').map(l => l.trim());
  let html = '';
  let listType = null;
  let items = [];
  const flush = () => {
    if (items.length) {
      html += `<${listType}>` + items.map(i => `<li>${inline(i)}</li>`).join('') + `</${listType}>`;
      items = [];
      listType = null;
    }
  };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    const ol = line.match(/^\d+[.、)]\s*(.+)/);
    const ul = line.match(/^[-*·]\s+(.+)/);
    if (ol) {
      if (listType !== 'ol') flush();
      listType = 'ol';
      items.push(ol[1]);
    } else if (ul) {
      if (listType !== 'ul') flush();
      listType = 'ul';
      items.push(ul[1]);
    } else {
      flush();
      html += `<p>${inline(line)}</p>`;
    }
  }
  flush();
  return html;
}

function inline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
