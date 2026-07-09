import { Router } from 'express';
import db from '../db.js';
import { generateSummary, isAvailable } from '../summarizer.js';

const router = Router();

// List articles — filter by blogger_id or topic_id
router.get('/', (req, res) => {
  const { blogger_id, topic_id } = req.query;

  let articles;
  if (topic_id) {
    articles = db.prepare(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      JOIN blogger_topics bt ON bt.blogger_id = b.id
      WHERE bt.topic_id = ?
      ORDER BY a.published_at DESC
      LIMIT 200
    `).all(topic_id);
  } else if (blogger_id) {
    articles = db.prepare(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      WHERE a.blogger_id = ?
      ORDER BY a.published_at DESC
      LIMIT 200
    `).all(blogger_id);
  } else {
    articles = db.prepare(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      ORDER BY a.published_at DESC
      LIMIT 200
    `).all();
  }

  res.json(articles);
});

// Get single article
router.get('/:id', (req, res) => {
  const article = db.prepare(`
    SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
    FROM articles a
    JOIN bloggers b ON b.id = a.blogger_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  res.json(article);
});

// Mark single article as read
router.put('/:id/read', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Article not found' });

  db.prepare('UPDATE articles SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ id: Number(req.params.id), is_read: 1 });
});

// Mark all articles for a blogger as read
router.put('/read-all', (req, res) => {
  const { blogger_id } = req.query;
  if (!blogger_id) return res.status(400).json({ error: 'blogger_id is required' });

  const result = db.prepare(
    'UPDATE articles SET is_read = 1 WHERE blogger_id = ? AND is_read = 0'
  ).run(blogger_id);

  res.json({ marked_read: result.changes });
});

// Generate AI summary for an article
router.post('/:id/summary', async (req, res) => {
  const article = db.prepare(`
    SELECT a.*, b.channel_type
    FROM articles a
    JOIN bloggers b ON b.id = a.blogger_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!article) return res.status(404).json({ error: 'Article not found' });

  // Return cached summary
  if (article.ai_summary) {
    return res.json({ summary: article.ai_summary, cached: true });
  }

  if (!isAvailable()) {
    return res.status(503).json({ error: 'API Key not configured' });
  }

  try {
    const { summary, basedOnDescription } = await generateSummary(article);
    const fullSummary = basedOnDescription
      ? `⚠️ 基于描述生成，非完整内容\n\n${summary}`
      : summary;

    db.prepare('UPDATE articles SET ai_summary = ? WHERE id = ?').run(fullSummary, article.id);
    res.json({ summary: fullSummary, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
