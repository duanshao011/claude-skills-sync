import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const topics = db.all(`
    SELECT t.*,
      (SELECT COUNT(DISTINCT bt2.blogger_id) FROM blogger_topics bt2 WHERE bt2.topic_id = t.id) as blogger_count,
      (SELECT COUNT(DISTINCT a.id) FROM blogger_topics bt3
        JOIN articles a ON a.blogger_id = bt3.blogger_id AND a.is_read = 0
        WHERE bt3.topic_id = t.id) as unread_count
    FROM topics t
    ORDER BY unread_count DESC, t.name ASC
  `);
  res.json(topics);
});

router.get('/:id', (req, res) => {
  const topic = db.get('SELECT * FROM topics WHERE id = ?', [req.params.id]);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const bloggers = db.all(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    JOIN blogger_topics bt ON bt.blogger_id = b.id
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    WHERE bt.topic_id = ?
    GROUP BY b.id
  `, [req.params.id]);

  res.json({ ...topic, bloggers });
});

router.post('/', (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = db.get('SELECT * FROM topics WHERE name = ?', [name]);
  if (existing) return res.status(409).json({ error: 'Topic name already exists' });

  const topic = db.transaction(() => {
    db.run('INSERT INTO topics (name, icon) VALUES (?, ?)', [name, icon || '📌']);
    const created = db.get('SELECT * FROM topics WHERE id = last_insert_rowid()');
    if (Array.isArray(req.body.blogger_ids) && req.body.blogger_ids.length > 0) {
      for (const bid of req.body.blogger_ids) {
        db.run('INSERT OR IGNORE INTO blogger_topics (blogger_id, topic_id) VALUES (?, ?)', [bid, created.id]);
      }
    }
    return created;
  })();

  res.status(201).json(topic);
});

router.put('/:id', (req, res) => {
  const { name, icon, blogger_ids } = req.body;
  const id = req.params.id;

  const topic = db.get('SELECT * FROM topics WHERE id = ?', [id]);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  db.transaction(() => {
    if (name || icon) {
      db.run('UPDATE topics SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?',
        [name || null, icon || null, id]);
    }
    if (Array.isArray(blogger_ids)) {
      db.run('DELETE FROM blogger_topics WHERE topic_id = ?', [id]);
      for (const bid of blogger_ids) {
        db.run('INSERT OR IGNORE INTO blogger_topics (blogger_id, topic_id) VALUES (?, ?)', [bid, id]);
      }
    }
  })();

  const updated = db.get('SELECT * FROM topics WHERE id = ?', [id]);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const topic = db.get('SELECT * FROM topics WHERE id = ?', [req.params.id]);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const deleted = db.transaction(() => {
    const topicLinks = db.run('DELETE FROM blogger_topics WHERE topic_id = ?', [req.params.id]).changes;
    const topics = db.run('DELETE FROM topics WHERE id = ?', [req.params.id]).changes;
    return { topic_links: topicLinks, topics };
  })();
  res.json({ deleted: true, name: topic.name, deleted_counts: deleted });
});

export default router;
