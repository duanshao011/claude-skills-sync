import { Router } from 'express';
import db from '../db.js';
import { generateSummary, isAvailable } from '../summarizer.js';
import { fetchGongzhonghaoContent } from '../fetchers/redfox.js';

const router = Router();

// 确保公众号文章正文就绪：有 workUuid 则抓取并落库
async function ensureGongzhonghaoContent(article) {
  if (article.content && article.content.trim().length > 50) {
    return { ok: true, cached: true };
  }
  if (!article.work_uuid) {
    return { ok: false, reason: 'noWorkUuid' };
  }
  const content = await fetchGongzhonghaoContent(article.work_uuid);
  if (!content || content.length < 20) {
    return { ok: false, reason: 'empty' };
  }
  db.run('UPDATE articles SET content = ? WHERE id = ?', [content, article.id]);
  article.content = content;
  return { ok: true, cached: false };
}

router.get('/', (req, res) => {
  const { blogger_id, topic_id } = req.query;

  let articles;
  if (topic_id) {
    articles = db.all(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      JOIN blogger_topics bt ON bt.blogger_id = b.id
      WHERE bt.topic_id = ?
      ORDER BY a.published_at DESC
      LIMIT 200
    `, [topic_id]);
  } else if (blogger_id) {
    articles = db.all(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      WHERE a.blogger_id = ?
      ORDER BY a.published_at DESC
      LIMIT 200
    `, [blogger_id]);
  } else {
    articles = db.all(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      ORDER BY a.published_at DESC
      LIMIT 200
    `);
  }

  res.json(articles);
});

router.get('/:id', (req, res) => {
  const article = db.get(`
    SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
    FROM articles a
    JOIN bloggers b ON b.id = a.blogger_id
    WHERE a.id = ?
  `, [req.params.id]);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  res.json(article);
});

router.put('/:id/read', (req, res) => {
  const article = db.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
  if (!article) return res.status(404).json({ error: 'Article not found' });

  db.run('UPDATE articles SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ id: Number(req.params.id), is_read: 1 });
});

router.put('/read-all', (req, res) => {
  const { blogger_id } = req.query;
  if (!blogger_id) return res.status(400).json({ error: 'blogger_id is required' });

  db.run('UPDATE articles SET is_read = 1 WHERE blogger_id = ? AND is_read = 0', [blogger_id]);
  res.json({ marked_read: true });
});

// Get article full content (公众号 via RedFox queryWork)
router.get('/:id/content', async (req, res) => {
  const article = db.get(`
    SELECT a.*, b.channel_type
    FROM articles a
    JOIN bloggers b ON b.id = a.blogger_id
    WHERE a.id = ?
  `, [req.params.id]);

  if (!article) return res.status(404).json({ error: 'Article not found' });

  if (article.channel_type !== 'gongzhonghao') {
    return res.json({ unsupported: true });
  }

  try {
    const r = await ensureGongzhonghaoContent(article);
    if (!r.ok) {
      if (r.reason === 'noWorkUuid') {
        return res.json({ noWorkUuid: true });
      }
      return res.status(502).json({ error: '未能获取正文' });
    }
    res.json({ content: article.content, cached: r.cached });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate AI summary
router.post('/:id/summary', async (req, res) => {
  const article = db.get(`
    SELECT a.*, b.channel_type
    FROM articles a
    JOIN bloggers b ON b.id = a.blogger_id
    WHERE a.id = ?
  `, [req.params.id]);

  if (!article) return res.status(404).json({ error: 'Article not found' });

  if (article.ai_summary) {
    return res.json({ summary: article.ai_summary, cached: true });
  }

  if (!isAvailable()) {
    return res.status(503).json({ error: 'API Key not configured' });
  }

  try {
    // 公众号：先确保正文就绪，用正文生成高质量摘要
    if (article.channel_type === 'gongzhonghao') {
      const r = await ensureGongzhonghaoContent(article);
      if (!r.ok) {
        if (r.reason === 'noWorkUuid') {
          return res.status(400).json({ error: '该文章无正文数据，请先对信息源点一次刷新后重试' });
        }
      }
    }

    const { summary, basedOnDescription } = await generateSummary(article);
    const fullSummary = basedOnDescription
      ? '⚠️ 基于标题和摘要生成，非完整内容\n\n' + summary
      : summary;

    db.run('UPDATE articles SET ai_summary = ? WHERE id = ?', [fullSummary, article.id]);
    res.json({ summary: fullSummary, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
