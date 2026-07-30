export function parseLongExtract(markdown) {
  const result = { warning: '', sections: [] };
  let section = null;
  let insight = null;

  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^-{3,}$/.test(line)) continue;

    if (line.startsWith('>')) {
      result.warning = cleanInline(line.replace(/^>\s*/, ''));
      continue;
    }

    const heading = cleanInline(line).match(/^【(.+?)】$/);
    if (heading) {
      section = {
        kind: sectionKind(heading[1]),
        title: heading[1],
        blocks: [],
      };
      result.sections.push(section);
      insight = null;
      continue;
    }

    if (!section) {
      section = { kind: 'plain', title: '萃取结果', blocks: [] };
      result.sections.push(section);
    }

    const insightMatch = line.match(/^[-*]\s+\*\*(洞见\d+)\*\*\s*[:：]\s*(.+)$/);
    if (insightMatch) {
      insight = {
        type: 'insight',
        label: insightMatch[1],
        text: cleanInline(insightMatch[2]),
        evidence: '',
        questions: '',
        notes: [],
      };
      section.blocks.push(insight);
      continue;
    }

    const evidenceMatch = line.match(/^[-*]\s+\*\*证据等级\*\*\s*[:：]\s*([ABC])\b/i);
    if (evidenceMatch && insight) {
      insight.evidence = evidenceMatch[1].toUpperCase();
      continue;
    }

    const questionMatch = line.match(/^[-*]\s+\*\*启发性追问\*\*\s*[:：]\s*(.+)$/);
    if (questionMatch && insight) {
      insight.questions = cleanInline(questionMatch[1]);
      continue;
    }

    const fieldMatch = line.match(/^(?:\d+\.\s*)?\*\*(.+?)\*\*\s*[:：]\s*(.*)$/);
    if (fieldMatch) {
      section.blocks.push({
        type: 'field',
        label: cleanInline(fieldMatch[1]),
        text: cleanInline(fieldMatch[2]),
      });
      insight = null;
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const text = cleanInline(bulletMatch[1]);
      if (insight && /^\s{2,}/.test(rawLine)) insight.notes.push(text);
      else section.blocks.push({ type: 'bullet', text });
      continue;
    }

    const numberedMatch = line.match(/^\d+[.、]\s*(.+)$/);
    if (numberedMatch) {
      section.blocks.push({ type: 'bullet', text: cleanInline(numberedMatch[1]), ordered: true });
      continue;
    }

    section.blocks.push({ type: 'paragraph', text: cleanInline(line) });
  }

  return result;
}

export function renderLongExtract(container, markdown) {
  const parsed = parseLongExtract(markdown);
  container.replaceChildren();

  if (parsed.warning) {
    const warning = createElement('div', 'summary-source-warning', parsed.warning);
    warning.setAttribute('role', 'note');
    container.append(warning);
  }

  if (!parsed.sections.length) {
    container.append(createElement('div', 'summary-empty', '暂无萃取结果'));
    return;
  }

  for (const section of parsed.sections) {
    const sectionEl = createElement('section', `summary-section summary-section-${section.kind}`);
    sectionEl.append(createElement('h4', 'summary-section-title', section.title));
    const body = createElement('div', 'summary-section-body');

    for (const block of section.blocks) {
      body.append(renderBlock(block));
    }

    sectionEl.append(body);
    container.append(sectionEl);
  }
}

function renderBlock(block) {
  if (block.type === 'insight') {
    const card = createElement('article', 'insight-card');
    const header = createElement('div', 'insight-header');
    header.append(createElement('span', 'insight-label', block.label));
    if (block.evidence) {
      const badge = createElement('span', `evidence-badge evidence-${block.evidence.toLowerCase()}`, `${block.evidence} 级证据`);
      badge.title = evidenceDescription(block.evidence);
      header.append(badge);
    }
    card.append(header, createElement('p', 'insight-text', block.text));
    for (const note of block.notes) card.append(createElement('blockquote', 'insight-quote', note));
    if (block.questions) {
      const question = createElement('div', 'insight-question');
      question.append(createElement('strong', '', '启发性追问'), createElement('p', '', block.questions));
      card.append(question);
    }
    return card;
  }

  if (block.type === 'field') {
    const field = createElement('div', 'summary-field');
    field.append(createElement('strong', 'summary-field-label', block.label));
    if (block.text) field.append(createElement('p', 'summary-field-text', block.text));
    return field;
  }

  if (block.type === 'bullet') {
    const item = createElement('div', `summary-bullet${block.ordered ? ' ordered' : ''}`);
    item.append(createElement('span', 'summary-bullet-mark', block.ordered ? '·' : '—'));
    item.append(createElement('p', '', block.text));
    return item;
  }

  return createElement('p', 'summary-paragraph', block.text);
}

function createElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function cleanInline(value) {
  return String(value || '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function sectionKind(title) {
  if (title.startsWith('第一部分')) return 'overview';
  if (title.startsWith('第二部分')) return 'insights';
  if (title.startsWith('第三部分')) return 'personal';
  if (title.startsWith('额外提炼')) return 'extra';
  return 'plain';
}

function evidenceDescription(level) {
  return {
    A: '强实证、严谨研究或公认理论支撑',
    B: '合理逻辑链、部分证据或可信规律观察',
    C: '推测、外推或作者个人观点',
  }[level] || '';
}
