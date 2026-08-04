import { Router } from 'express';
import db, { randomColor } from '../db.js';

const router = Router();

// List all bloggers with unread count
router.get('/', (req, res) => {
  const bloggers = db.all(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    GROUP BY b.id
    ORDER BY unread_count DESC, b.name ASC
  `);
  res.json(bloggers);
});

// Get topics for a blogger
router.get('/:id/topics', (req, res) => {
  const topics = db.all(`
    SELECT t.* FROM topics t
    JOIN blogger_topics bt ON bt.topic_id = t.id
    WHERE bt.blogger_id = ?
  `, [req.params.id]);
  res.json({ topics });
});

// Get single blogger
router.get('/:id', (req, res) => {
  const blogger = db.get(`
    SELECT b.*, COUNT(a.id) as unread_count
    FROM bloggers b
    LEFT JOIN articles a ON a.blogger_id = b.id AND a.is_read = 0
    WHERE b.id = ?
    GROUP BY b.id
  `, [req.params.id]);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });
  res.json(blogger);
});

// Add blogger
router.post('/', (req, res) => {
  const { name, channel_type, channel_id, avatar_url, channel_account } = req.body;
  if (!name || !channel_type || !channel_id) {
    return res.status(400).json({ error: 'name, channel_type, channel_id are required' });
  }

  const color = randomColor(name);
  // 头像 URL 来自前端透传，只接受 http(s)，拒绝 javascript: 等危险协议
  const avatarUrl = /^https?:\/\//i.test(String(avatar_url || '')) ? String(avatar_url) : null;
  const account = channel_account ? String(channel_account) : null;

  // Check if already exists — 同一个号可能既被用名称加过、又被用微信号加过
  const existing = db.get(
    account
      ? 'SELECT * FROM bloggers WHERE channel_type = ? AND (channel_id = ? OR channel_account = ?)'
      : 'SELECT * FROM bloggers WHERE channel_type = ? AND channel_id = ?',
    account ? [channel_type, channel_id, account] : [channel_type, channel_id]
  );
  if (existing) return res.json({ ...existing, already_exists: true });

  db.run(
    'INSERT INTO bloggers (name, channel_type, channel_id, avatar_color, avatar_url, channel_account) VALUES (?, ?, ?, ?, ?, ?)',
    [name, channel_type, channel_id, color, avatarUrl, account]
  );

  const blogger = db.get('SELECT * FROM bloggers WHERE id = last_insert_rowid()');
  db.save();
  res.status(201).json(blogger);

  // Fetch avatar async (don't block response)
  if (channel_type === 'youtube') {
    import('../fetchers/youtube.js').then(async ({ extractAvatar }) => {
      const avatarUrl = await extractAvatar(channel_id);
      if (avatarUrl) {
        db.run('UPDATE bloggers SET avatar_url = ? WHERE id = ?', [avatarUrl, blogger.id]);
        db.save();
      }
    });
  }
});

// Delete blogger
router.delete('/:id', (req, res) => {
  const blogger = db.get('SELECT * FROM bloggers WHERE id = ?', [req.params.id]);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  const deleted = db.transaction(() => {
    const articles = db.run('DELETE FROM articles WHERE blogger_id = ?', [req.params.id]).changes;
    const topicLinks = db.run('DELETE FROM blogger_topics WHERE blogger_id = ?', [req.params.id]).changes;
    const bloggers = db.run('DELETE FROM bloggers WHERE id = ?', [req.params.id]).changes;
    return { articles, topic_links: topicLinks, bloggers };
  })();
  res.json({ deleted: true, name: blogger.name, deleted_counts: deleted });
});

// Update blogger's topic assignments
router.put('/:id/topics', (req, res) => {
  const { topic_ids } = req.body;
  const id = req.params.id;

  const blogger = db.get('SELECT * FROM bloggers WHERE id = ?', [id]);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  db.transaction(() => {
    db.run('DELETE FROM blogger_topics WHERE blogger_id = ?', [id]);
    if (Array.isArray(topic_ids) && topic_ids.length > 0) {
      for (const tid of topic_ids) {
        db.run('INSERT OR IGNORE INTO blogger_topics (blogger_id, topic_id) VALUES (?, ?)', [id, tid]);
      }
    }
  })();

  const topics = db.all(`
    SELECT t.* FROM topics t
    JOIN blogger_topics bt ON bt.topic_id = t.id
    WHERE bt.blogger_id = ?
  `, [id]);

  res.json({ blogger_id: Number(id), topics });
});

export default router;
