import { Router } from 'express';
import db from '../db.js';
import { fetchAll, fetchBlogger, youtube } from '../fetchers/index.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const results = await fetchAll();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate channel before adding (must be before /:id)
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

    // Handle parse errors (search URLs, video URLs, etc.)
    if (parsed.type === 'error') {
      return res.status(400).json({ error: parsed.reason });
    }

    let channelId = parsed.value;

    if (parsed.type === 'handle') {
      const resolved = await youtube.resolveHandle(parsed.value);
      if (resolved) {
        channelId = resolved;
      } else {
        return res.status(400).json({
          error: '无法从 @' + parsed.value + ' 获取频道ID，请尝试在浏览器中打开该频道，复制频道主页的完整链接（youtube.com/channel/UC... 格式）',
        });
      }
    }

    if (parsed.type === 'unknown') {
      return res.status(400).json({
        error: parsed.reason || '无法识别输入格式，请粘贴完整的频道链接',
      });
    }

    // Try RSS validation, but don't block on failure (temporary rate-limit)
    let channelName = '';
    let rssOk = true;
    try {
      const result = await youtube.validate(channelId);
      channelName = result.channel_name;
    } catch (err) {
      rssOk = false;
      channelName = parsed.type === 'handle' ? '@' + parsed.value : channelId;
    }

    res.json({
      valid: true,
      channel_id: channelId,
      channel_name: channelName,
      rss_available: rssOk,
    });
  } catch (err) {
    res.status(400).json({
      error: '频道验证失败，请检查URL或频道ID是否正确',
      detail: err.message,
    });
  }
});

router.get('/status', (req, res) => {
  const row = db.get(`
    SELECT MAX(last_fetched_at) as last_fetch, COUNT(*) as blogger_count
    FROM bloggers
  `);

  res.json({
    last_fetch: row ? row.last_fetch : null,
    blogger_count: row ? row.blogger_count : 0,
  });
});

router.post('/:id', async (req, res) => {
  const blogger = db.get('SELECT * FROM bloggers WHERE id = ?', [req.params.id]);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });

  try {
    const result = await fetchBlogger(blogger);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
