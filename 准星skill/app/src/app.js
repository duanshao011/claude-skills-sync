import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bloggersRouter from './routes/bloggers.js';
import topicsRouter from './routes/topics.js';
import articlesRouter from './routes/articles.js';
import fetchRouter from './routes/fetch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (req, res) => res.json({
    app: 'zhunxing',
    status: 'ok',
    pid: process.pid,
    providers: {
      youtube: { configured: true, validate: true, fetch: true },
      douyin: { configured: Boolean(process.env.REDFOX_API_KEY), validate: true, fetch: true },
      wechat: { configured: Boolean(process.env.REDFOX_API_KEY), validate: true, fetch: true },
      xiaohongshu: { configured: Boolean(process.env.REDFOX_API_KEY), validate: true, fetch: false },
    },
  }));
  app.use('/api/bloggers', bloggersRouter);
  app.use('/api/topics', topicsRouter);
  app.use('/api/articles', articlesRouter);
  app.use('/api/fetch', fetchRouter);
  app.get('/api/config', (req, res) => {
    const redfoxAvailable = Boolean(process.env.REDFOX_API_KEY);
    res.json({
      summaryAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
      providers: {
        youtube: { available: true },
        douyin: { available: redfoxAvailable },
        wechat: { available: redfoxAvailable },
        xiaohongshu: {
          available: false,
          reason: '缺少按博主作品列表接口契约',
        },
      },
    });
  });
  app.use(express.static(publicDir));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  return app;
}

export default createApp();
