import { Router } from 'express';
import db from '../db.js';
import { fetchManager, validateChannel, searchChannel } from '../fetchers/index.js';
import { ProviderError, serializeProviderError } from '../providers/errors.js';

const router = Router();

function sendProviderError(res, error) {
  const status = error instanceof ProviderError && error.code !== 'PROVIDER_FETCH_FAILED' ? 503 : 400;
  const detail = serializeProviderError(error);
  res.status(status).json({
    error: detail.message,
    code: detail.code,
    provider: detail.provider,
    retryable: detail.retryable,
  });
}

router.post('/', (req, res) => {
  const task = fetchManager.enqueueAll();
  res.status(202).json({ task_id: task.id, status: task.status });
});

router.post('/validate', async (req, res) => {
  const { channel_type: channelType, channel_input: channelInput } = req.body || {};
  if (!channelType || !channelInput) {
    return res.status(400).json({ error: 'channel_type and channel_input are required' });
  }

  try {
    res.json(await validateChannel(channelType, channelInput));
  } catch (error) {
    sendProviderError(res, error);
  }
});

router.post('/search', async (req, res) => {
  const { channel_type: channelType, keyword } = req.body || {};
  if (!channelType || !keyword) {
    return res.status(400).json({ error: 'channel_type and keyword are required' });
  }
  try {
    res.json(await searchChannel(channelType, keyword));
  } catch (error) {
    sendProviderError(res, error);
  }
});

router.get('/status', (req, res) => {
  const summary = db.get(`SELECT MAX(last_fetched_at) AS last_fetch,
    COUNT(*) AS blogger_count,
    SUM(CASE WHEN last_fetch_status = 'running' THEN 1 ELSE 0 END) AS running_count,
    SUM(CASE WHEN last_fetch_status = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM bloggers`);
  const tasks = fetchManager.list();
  const latest = tasks[0] || null;
  res.json({
    status: latest?.status || 'idle',
    total: latest?.progress?.total || 0,
    completed: latest?.progress?.completed || 0,
    succeeded: latest?.progress?.succeeded || 0,
    failed: latest?.progress?.failed || 0,
    results: Array.isArray(latest?.result) ? latest.result : (latest?.result ? [latest.result] : []),
    error: latest?.error || null,
    task_id: latest?.id || null,
    last_fetch: summary?.last_fetch || null,
    blogger_count: summary?.blogger_count || 0,
    running_count: summary?.running_count || 0,
    failed_count: summary?.failed_count || 0,
    bloggers: db.all(`SELECT id, name, channel_type, last_fetched_at, last_fetch_attempted_at,
      last_fetch_status, last_fetch_error, fetch_cursor FROM bloggers ORDER BY id`),
    tasks,
  });
});

router.get('/status/:taskId', (req, res) => {
  const task = fetchManager.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Fetch task not found' });
  res.json(task);
});

router.post('/:id', (req, res) => {
  const blogger = db.get('SELECT * FROM bloggers WHERE id = ?', [req.params.id]);
  if (!blogger) return res.status(404).json({ error: 'Blogger not found' });
  const task = fetchManager.enqueueBlogger(blogger);
  res.status(202).json({ task_id: task.id, status: task.status, blogger_id: blogger.id });
});

export default router;
