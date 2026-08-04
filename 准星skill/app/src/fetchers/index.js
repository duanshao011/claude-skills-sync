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

export async function searchChannel(channelType, keyword) {
  const fetcher = getFetcher(channelType);
  if (!fetcher?.search) {
    throw new ProviderError(PROVIDER_ERROR_CODES.NOT_SUPPORTED, `${channelType} 暂不支持账号搜索`, {
      provider: channelType,
    });
  }
  return fetcher.search(keyword);
}

// ── 公众号资料懒回填 ────────────────────────────────────────────────────

// 老号是按「名称」加进来的，没有头像也没有微信号。抓取前顺手搜一次补齐，
// 靠 profile_synced_at 保证每个号只搜一次（每次 ¥0.04），搜不到也不再重试。
async function syncWechatProfile(blogger) {
  if (blogger.channel_type !== 'wechat') return blogger;
  if (blogger.profile_synced_at || blogger.channel_account) return blogger;

  const { results } = await wechat.search(blogger.name);
  const matched = wechat.pickAccountMatch(blogger.name, results);

  db.transaction(() => {
    // 无论匹配成功与否，先标记已搜，不再重复花钱
    db.run(`UPDATE bloggers SET profile_synced_at = datetime('now','localtime') WHERE id = ?`, [blogger.id]);
    if (!matched) return;
    db.run(`UPDATE bloggers SET name = ?, avatar_url = COALESCE(?, avatar_url), channel_account = ?
      WHERE id = ?`, [matched.name || blogger.name, matched.avatar_url, matched.account || null, blogger.id]);
    // channel_id 迁成微信号。撞唯一约束（用户先前已用微信号加过同一个号）时跳过迁移，只留存 channel_account。
    const clash = matched.account && db.get(
      'SELECT id FROM bloggers WHERE channel_type = ? AND channel_id = ? AND id <> ?',
      ['wechat', matched.account, blogger.id]);
    if (clash) {
      console.warn(`[Fetcher] 回填头像时发现重复博主：${blogger.name}（id=${blogger.id}）与 ${clash.name}（id=${clash.id}）指向同一微信号 ${matched.account}。头像已写入 id=${blogger.id}，但 channel_id 未迁移以免违反 UNIQUE 约束。建议手动删除重复项。`);
    } else if (matched.account) {
      db.run('UPDATE bloggers SET channel_id = ? WHERE id = ?', [matched.account, blogger.id]);
    }
  })();

  return db.get('SELECT * FROM bloggers WHERE id = ?', [blogger.id]);
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
    // 公众号资料懒回填：老号抓取前自动搜一次补头像和微信号，失败不影响抓取
    try {
      blogger = await syncWechatProfile(blogger);
    } catch (error) {
      console.error('[Fetcher] 公众号资料回填失败（不影响抓取）:', error.message);
    }
    const rawResult = await fetcher.fetchChannel(blogger.channel_id, {
      cursor: blogger.fetch_cursor,
      account: blogger.channel_account,
    });
    const { articles, cursor, channelName } = normalizeFetchResult(rawResult);
    const result = insertArticles(blogger.id, articles);

    // 抓取成功后用数据源返回的真实昵称覆盖显示名（用户输入可能大小写/别名不精确）。
    if (channelName && channelName !== blogger.name) {
      db.run('UPDATE bloggers SET name = ? WHERE id = ?', [channelName, blogger.id]);
    }

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
