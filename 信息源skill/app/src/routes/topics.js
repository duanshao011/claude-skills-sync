import { Router } from 'express';
import db from '../db.js';

const router = Router();

// List all topics with blogger count and unread count
router.get('/', (req, res) => {
  const topics = db.prepare(`
    SELECT t.*,
      COUNT(DISTINCT bt.blogger_id) as blogger_count,
      COUNT(DISTINCT a.id) as unread_count
    FROM topics t
    LEFT JOIN blogger_topics bt ON bt.topic_id = t.id
    LEFT JOIN articles a ON a.blogger_id = bt.blogger_id AND a.is_read = 0
    GROUP BY t.id
    ORDER BY unread_count DESC, t.name ASC
  `).all();
  res.json(topics);
});

// Get single topic with its bloggers
router.get('/:id', (req, res) => {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const bloggers = db.prepare(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    JOIN blogger_topics bt ON bt.blogger_id = b.id
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    WHERE bt.topic_id = ?
    GROUP BY b.id
  `).all(req.params.id);

  res.json({ ...topic, bloggers });
});

// Create topic
router.post('/', (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const result = db.prepare('INSERT INTO topics (name, icon) VALUES (?, ?)').run(name, icon || '📌');
    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(topic);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Topic name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update topic
router.put('/:id', (req, res) => {
  const { name, icon, blogger_ids } = req.body;
  const id = req.params.id;

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const updateTopic = db.transaction(() => {
    if (name || icon) {
      db.prepare('UPDATE topics SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?')
        .run(name || null, icon || null, id);
    }
    if (Array.isArray(blogger_ids)) {
      db.prepare('DELETE FROM blogger_topics WHERE topic_id = ?').run(id);
      const insert = db.prepare('INSERT OR IGNORE INTO blogger_topics (blogger_id, topic_id) VALUES (?, ?)');
      for (const bid of blogger_ids) insert.run(bid, id);
    }
  });
  updateTopic();

  const updated = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  res.json(updated);
});

// Delete topic
router.delete('/:id', (req, res) => {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, name: topic.name });
});

export default router;
