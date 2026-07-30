import db from '../db.js';
import * as youtube from './youtube.js';
import * as redfox from './redfox.js';
import { translateArticles, isAvailable as translationAvailable } from '../translator.js';

const fetchers = {
  youtube,
  'douyin-hot': redfox,
  'douyin-account': redfox,
  xiaohongshu: redfox,
  bilibili: redfox,
  gongzhonghao: redfox,
};

export function getFetcher(channelType) {
  return fetchers[channelType] || null;
}

export async function fetchBlogger(blogger) {
  const fetcher = getFetcher(blogger.channel_type);
  if (!fetcher) {
    throw new Error('No fetcher for channel type: ' + blogger.channel_type);
  }

  // Retry up to 3 times with delay (YouTube may rate-limit)
  let articles;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      articles = await fetcher.fetchChannel(blogger.channel_id, blogger.channel_type);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  if (!articles) throw lastErr;

  let inserted = 0;
  const newArticles = [];
  db.run('BEGIN');
  try {
    for (const a of articles) {
      const existing = db.get(
        'SELECT id FROM articles WHERE blogger_id = ? AND url = ?',
        [blogger.id, a.url]
      );
      if (!existing) {
        db.run(
          'INSERT INTO articles (blogger_id, title, url, summary, thumbnail, published_at) VALUES (?, ?, ?, ?, ?, ?)',
          [blogger.id, a.title, a.url, a.summary, a.thumbnail, a.published_at]
        );
        const newId = db.get('SELECT last_insert_rowid() as id').id;
        a.id = newId;
        newArticles.push(a);
        inserted++;
      }
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  // Translate new articles if AI key available
  if (translationAvailable() && newArticles.length > 0) {
    try {
      await translateArticles(newArticles);
      db.run('BEGIN');
      for (const a of newArticles) {
        if (a.title_cn || a.summary_cn) {
          db.run(
            'UPDATE articles SET title_cn = COALESCE(?, title_cn), summary_cn = COALESCE(?, summary_cn) WHERE id = ?',
            [a.title_cn || null, a.summary_cn || null, a.id]
          );
        }
      }
      db.run('COMMIT');
    } catch (err) {
      console.error('[Fetcher] Translation failed:', err.message);
    }
  }

  db.run(
    'UPDATE bloggers SET last_fetched_at = datetime(\'now\',\'localtime\') WHERE id = ?',
    [blogger.id]
  );

  return { blogger: blogger.name, fetched: articles.length, inserted };
}

export async function fetchAll() {
  const bloggers = db.all('SELECT * FROM bloggers');
  const results = [];

  for (const blogger of bloggers) {
    try {
      const r = await fetchBlogger(blogger);
      results.push({ ...r, success: true });
    } catch (err) {
      results.push({ blogger: blogger.name, error: err.message, success: false });
    }
  }

  return results;
}

export { youtube };
