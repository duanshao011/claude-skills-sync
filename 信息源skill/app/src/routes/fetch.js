import { Router } from 'express';
import db from '../db.js';
import { fetchAll, fetchBlogger, youtube } from '../fetchers/index.js';

const router = Router();

// Fetch all bloggers
router.post('/', async (req, res) => {
  try {
    const results = await fetchAll();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch single blogger
router.post('/:id', async (req, res) => {
  const blogger = db.prepare('SELECT * FROM bloggers WHERE id = ?').get(req.params.id);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  try {
    const result = await fetchBlogger(blogger);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get fetch status
router.get('/status', (req, res) => {
  const row = db.prepare(`
    SELECT MAX(last_fetched_at) as last_fetch, COUNT(*) as blogger_count
    FROM bloggers
  `).get();

  res.json({
    last_fetch: row.last_fetch || null,
    blogger_count: row.blogger_count || 0,
  });
});

// Validate a YouTube channel before adding
router.post('/validate', async (req, res) => {
  const { channel_type, channel_input } = req.body;
  if (channel_type !== 'youtube') {
    return res.status(400).json({ error: 'Only youtube is supported currently' });
  }
  if (!channel_input) {
    return res.status(400).json({ error: 'channel_input is required' });
  }

  try {
    const parsed = youtube.parseChannelUrl(channel_input);
    let channelId = parsed.value;

    if (parsed.type === 'handle' || parsed.type === 'unknown') {
      const resolved = await youtube.resolveHandle(
        parsed.type === 'handle' ? parsed.value : parsed.value
      );
      if (resolved) {
        channelId = resolved;
      } else {
        return res.status(400).json({
          error: '无法解析该频道，请尝试直接输入频道ID（UC开头的字符串）',
        });
      }
    }

    const result = await youtube.validate(channelId);
    res.json({
      valid: true,
      channel_id: channelId,
      channel_name: result.channel_name,
    });
  } catch (err) {
    res.status(400).json({
      error: '频道验证失败，请检查URL或频道ID是否正确',
      detail: err.message,
    });
  }
});

export default router;
