import { Router } from 'express';
import db, { randomColor } from '../db.js';

const router = Router();

// List all bloggers with unread count
router.get('/', (req, res) => {
  const bloggers = db.prepare(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    GROUP BY b.id
    ORDER BY unread_count DESC, b.name ASC
  `).all();
  res.json(bloggers);
});

// Get topics for a blogger
router.get('/:id/topics', (req, res) => {
  const topics = db.prepare(`
    SELECT t.* FROM topics t
    JOIN blogger_topics bt ON bt.topic_id = t.id
    WHERE bt.blogger_id = ?
  `).all(req.params.id);
  res.json({ topics });
});

// Get single blogger
router.get('/:id', (req, res) => {
  const blogger = db.prepare(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    WHERE b.id = ?
    GROUP BY b.id
  `).get(req.params.id);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });
  res.json(blogger);
});

// Add blogger
router.post('/', (req, res) => {
  const { name, channel_type, channel_id } = req.body;
  if (!name || !channel_type || !channel_id) {
    return res.status(400).json({ error: 'name, channel_type, channel_id are required' });
  }

  const color = randomColor(name);
  try {
    const result = db.prepare(
      'INSERT OR IGNORE INTO bloggers (name, channel_type, channel_id, avatar_color) VALUES (?, ?, ?, ?)'
    ).run(name, channel_type, channel_id, color);

    if (result.changes === 0) {
      const existing = db.prepare(
        'SELECT * FROM bloggers WHERE channel_type = ? AND channel_id = ?'
      ).get(channel_type, channel_id);
      return res.json({ ...existing, already_exists: true });
    }

    const blogger = db.prepare('SELECT * FROM bloggers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(blogger);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete blogger (articles cascade-deleted)
router.delete('/:id', (req, res) => {
  const blogger = db.prepare('SELECT * FROM bloggers WHERE id = ?').get(req.params.id);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  db.prepare('DELETE FROM bloggers WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, name: blogger.name });
});

// Update blogger's topic assignments
router.put('/:id/topics', (req, res) => {
  const { topic_ids } = req.body;
  const id = req.params.id;

  const blogger = db.prepare('SELECT * FROM bloggers WHERE id = ?').get(id);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  const updateTopics = db.transaction(() => {
    db.prepare('DELETE FROM blogger_topics WHERE blogger_id = ?').run(id);
    if (Array.isArray(topic_ids) && topic_ids.length > 0) {
      const insert = db.prepare('INSERT OR IGNORE INTO blogger_topics (blogger_id, topic_id) VALUES (?, ?)');
      for (const tid of topic_ids) insert.run(id, tid);
    }
  });
  updateTopics();

  const topics = db.prepare(`
    SELECT t.* FROM topics t
    JOIN blogger_topics bt ON bt.topic_id = t.id
    WHERE bt.blogger_id = ?
  `).all(id);

  res.json({ blogger_id: Number(id), topics });
});

export default router;
