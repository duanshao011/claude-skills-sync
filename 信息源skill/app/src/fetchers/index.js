import db from '../db.js';
import * as youtube from './youtube.js';

const fetchers = { youtube };

export function getFetcher(channelType) {
  return fetchers[channelType] || null;
}

export async function fetchBlogger(blogger) {
  const fetcher = getFetcher(blogger.channel_type);
  if (!fetcher) {
    throw new Error('No fetcher for channel type: ' + blogger.channel_type);
  }

  const articles = await fetcher.fetch(blogger.channel_id);

  let inserted = 0;
  db.run('BEGIN');
  try {
    for (const a of articles) {
      // Check duplicate
      const existing = db.get(
        'SELECT id FROM articles WHERE blogger_id = ? AND url = ?',
        [blogger.id, a.url]
      );
      if (!existing) {
        db.run(
          'INSERT INTO articles (blogger_id, title, url, summary, thumbnail, published_at) VALUES (?, ?, ?, ?, ?, ?)',
          [blogger.id, a.title, a.url, a.summary, a.thumbnail, a.published_at]
        );
        inserted++;
      }
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
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
