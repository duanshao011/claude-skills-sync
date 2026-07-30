import db from '../db.js';
import * as youtube from './youtube.js';
import * as xiaohongshu from './xiaohongshu.js';
import * as douyin from './douyin.js';
import * as wechat from './wechat.js';
import { translateArticles, isAvailable as translationAvailable } from '../translator.js';
import { FetchManager } from '../fetch-manager.js';
import { ProviderError, PROVIDER_ERROR_CODES, serializeProviderError } from '../providers/errors.js';
import { normalizeFetchResult } from '../providers/normalize.js';

const fetchers = { youtube, xiaohongshu, douyin, wechat };

export function getFetcher(channelType) {
  return fetchers[channelType] || null;
}

export async function validateChannel(channelType, channelInput) {
  const fetcher = getFetcher(channelType);
  if (!fetcher) {
    throw new ProviderError(PROVIDER_ERROR_CODES.NOT_SUPPORTED, `Unsupported provider: ${channelType}`, {
      provider: channelType,
    });
  }

  if (channelType !== 'youtube') return fetcher.validate(channelInput);

  const parsed = fetcher.parseChannelUrl(channelInput);
  if (parsed.type === 'error' || parsed.type === 'unknown') {
    throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, parsed.reason, { provider: channelType });
  }

  let channelId = parsed.value;
  if (parsed.type === 'handle') {
    channelId = await fetcher.resolveHandle(parsed.value);
    if (!channelId) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, `无法解析 @${parsed.value} 的频道 ID`, {
        provider: channelType,
      });
    }
  }

  let channelName = channelId;
  let rssAvailable = true;
  try {
    const result = await fetcher.validate(channelId);
    channelName = result.channel_name || channelName;
  } catch {
    rssAvailable = false;
  }
  return { valid: true, channel_id: channelId, channel_name: channelName, rss_available: rssAvailable };
}

export async function fetchBlogger(blogger) {
  const fetcher = getFetcher(blogger.channel_type);
  if (!fetcher) {
    throw new ProviderError(PROVIDER_ERROR_CODES.NOT_SUPPORTED, `Unsupported provider: ${blogger.channel_type}`, {
      provider: blogger.channel_type,
    });
  }

  db.run(`UPDATE bloggers SET last_fetch_attempted_at = datetime('now','localtime'),
    last_fetch_status = 'running', last_fetch_error = NULL WHERE id = ?`, [blogger.id]);
  db.save();

  try {
    const rawResult = await fetcher.fetchChannel(blogger.channel_id, { cursor: blogger.fetch_cursor });
    const { articles, cursor } = normalizeFetchResult(rawResult);
    const result = insertArticles(blogger.id, articles);

    if (blogger.channel_type === 'youtube' && translationAvailable() && result.newArticles.length > 0) {
      try {
        await translateArticles(result.newArticles);
        db.transaction(() => {
          for (const article of result.newArticles) {
            if (article.title_cn || article.summary_cn) {
              db.run(`UPDATE articles SET title_cn = COALESCE(?, title_cn),
                summary_cn = COALESCE(?, summary_cn) WHERE id = ?`,
              [article.title_cn, article.summary_cn, article.id]);
            }
          }
        })();
      } catch (error) {
        console.error('[Fetcher] Translation failed:', error.message);
      }
    }

    db.run(`UPDATE bloggers SET last_fetched_at = datetime('now','localtime'),
      last_fetch_status = 'success', last_fetch_error = NULL,
      fetch_cursor = COALESCE(?, fetch_cursor) WHERE id = ?`, [cursor, blogger.id]);
    db.save();
    return { blogger: blogger.name, blogger_id: blogger.id, fetched: articles.length, inserted: result.inserted, success: true };
  } catch (error) {
    const detail = serializeProviderError(error);
    db.run(`UPDATE bloggers SET last_fetch_status = 'failed', last_fetch_error = ? WHERE id = ?`,
      [JSON.stringify(detail), blogger.id]);
    db.save();
    throw error;
  }
}

function insertArticles(bloggerId, articles) {
  return db.transaction(() => {
    let inserted = 0;
    const newArticles = [];
    for (const article of articles) {
      const existing = article.external_id
        ? db.get('SELECT id FROM articles WHERE blogger_id = ? AND (external_id = ? OR url = ?)',
          [bloggerId, article.external_id, article.url])
        : db.get('SELECT id FROM articles WHERE blogger_id = ? AND url = ?', [bloggerId, article.url]);
      if (existing) continue;

      db.run(`INSERT INTO articles
        (blogger_id, title, title_cn, url, external_id, summary, summary_cn, thumbnail, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        bloggerId, article.title, article.title_cn, article.url, article.external_id,
        article.summary, article.summary_cn, article.thumbnail, article.published_at,
      ]);
      article.id = db.get('SELECT last_insert_rowid() AS id').id;
      newArticles.push(article);
      inserted++;
    }
    return { inserted, newArticles };
  })();
}

export async function fetchAll({ onProgress } = {}) {
  const bloggers = db.all('SELECT * FROM bloggers');
  const results = [];
  let succeeded = 0;
  let failed = 0;
  onProgress?.({ total: bloggers.length, completed: 0, succeeded, failed, current_blogger_id: null });

  for (const blogger of bloggers) {
    onProgress?.({ current_blogger_id: blogger.id });
    try {
      results.push(await fetchBlogger(blogger));
      succeeded++;
    } catch (error) {
      failed++;
      results.push({
        blogger: blogger.name,
        blogger_id: blogger.id,
        success: false,
        error: serializeProviderError(error),
      });
    }
    onProgress?.({
      total: bloggers.length,
      completed: results.length,
      succeeded,
      failed,
      current_blogger_id: null,
    });
  }
  return results;
}

export const fetchManager = new FetchManager({ fetchAll, fetchOne: fetchBlogger });
export { youtube, xiaohongshu, douyin, wechat };
