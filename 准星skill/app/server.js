import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import open from 'open';

import bloggersRouter from './src/routes/bloggers.js';
import topicsRouter from './src/routes/topics.js';
import articlesRouter from './src/routes/articles.js';
import fetchRouter from './src/routes/fetch.js';
import { fetchAll } from './src/fetchers/index.js';
import db from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/bloggers', bloggersRouter);
app.use('/api/topics', topicsRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/fetch', fetchRouter);

// Config endpoint (for checking if AI summary is available)
app.get('/api/config', (req, res) => {
  res.json({
    summaryAvailable: !!process.env.DEEPSEEK_API_KEY,
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Scheduled fetch: every day at 06:00
cron.schedule('0 6 * * *', async () => {
  console.log('[Cron] Starting daily fetch...');
  try {
    const results = await fetchAll();
    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    console.log(`[Cron] Done — ${ok} ok, ${fail} failed`);
  } catch (err) {
    console.error('[Cron] Error:', err.message);
  }
});

// Startup check: if last fetch > 24h ago, catch up
async function checkStartupFetch() {
  const row = db.get('SELECT MAX(last_fetched_at) as last_fetch FROM bloggers');
  if (!row || !row.last_fetch) return;

  const lastFetch = new Date(row.last_fetch + 'Z');
  const hoursSince = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60);
  if (hoursSince > 24) {
    console.log(`[Startup] Last fetch ${Math.round(hoursSince)}h ago, catching up...`);
    try {
      const results = await fetchAll();
      const ok = results.filter(r => r.success).length;
      console.log(`[Startup] Catch-up done — ${ok} ok`);
    } catch (err) {
      console.error('[Startup] Catch-up error:', err.message);
    }
  }
}

app.listen(PORT, async () => {
  console.log(`准星 running at http://localhost:${PORT}`);
  await checkStartupFetch();
});

// Auto-open browser (only when not already opened by launcher script)
const autoOpen = !process.env.NO_AUTO_OPEN;
if (autoOpen) {
  setTimeout(() => {
    open(`http://localhost:${PORT}`).catch(() => {});
  }, 800);
}
