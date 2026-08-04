export function normalizeArticle(article) {
  if (!article || typeof article !== 'object') throw new TypeError('Provider article must be an object');
  const url = stringOrEmpty(article.url);
  const externalId = nullableString(article.externalId ?? article.external_id);
  if (!url && !externalId) throw new TypeError('Provider article requires url or externalId');

  return {
    title: stringOrEmpty(article.title),
    title_cn: nullableString(article.titleCn ?? article.title_cn),
    url,
    external_id: externalId,
    summary: nullableString(article.summary),
    summary_cn: nullableString(article.summaryCn ?? article.summary_cn),
    thumbnail: nullableString(article.thumbnail),
    published_at: normalizeDate(article.publishedAt ?? article.published_at),
  };
}

export function normalizeFetchResult(result) {
  const source = Array.isArray(result) ? { articles: result } : (result || {});
  return {
    articles: (source.articles || []).map(normalizeArticle),
    cursor: nullableString(source.cursor),
    channelName: nullableString(source.channelName),
  };
}

function nullableString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function stringOrEmpty(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
