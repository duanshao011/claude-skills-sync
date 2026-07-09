import db from '../db.js';
import * as youtube from './youtube.js';

const fetchers = { youtube };

export function getFetcher(channelType) {
  return fetchers[channelType] || null;
}

export async function fetchBlogger(blogger) {
  const fetcher = getFetcher(blogger.channel_type);
  if (!fetcher) {
    throw new Error(`No fetcher for channel type: ${blogger.channel_type}`);
  }

  const articles = await fetcher.fetch(blogger.channel_id);

  let inserted = 0;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO articles (blogger_id, title, url, summary, thumbnail, published_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const a of items) {
      const result = insertStmt.run(
        blogger.id, a.title, a.url, a.summary, a.thumbnail, a.published_at
      );
      if (result.changes > 0) inserted++;
    }
  });
  insertMany(articles);

  db.prepare(`UPDATE bloggers SET last_fetched_at = datetime('now','localtime') WHERE id = ?`).run(blogger.id);

  return { blogger: blogger.name, fetched: articles.length, inserted };
}

export async function fetchAll() {
  const bloggers = db.prepare('SELECT * FROM bloggers').all();
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
