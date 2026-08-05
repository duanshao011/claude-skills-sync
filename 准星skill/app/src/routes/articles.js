import { Router } from 'express';
import db from '../db.js';
import { generateSummary, isAvailable } from '../summarizer.js';
import { decodeSummaryCache, encodeSummaryCache } from '../prompts/summary.js';
import { createRedfoxClient } from '../clients/redfox.js';

const LIMITED_SOURCE_WARNING = '> 内容完整度提示：当前只能获取标题与来源描述，以下是基于有限信息生成的萃取，不等同于全文分析。';

export function createArticlesRouter(dependencies = {}) {
  const database = dependencies.db || db;
  const summaryGenerator = dependencies.generateSummary || generateSummary;
  const summaryAvailable = dependencies.isAvailable || isAvailable;
  const inFlight = new Map();
  const router = Router();

  router.get('/', (req, res) => {
    const { blogger_id, topic_id, starred } = req.query;

    let articles;
    if (starred === '1' || starred === 'true') {
      // 星标合集跨博主，按标记时间倒序——最近标的排最前，符合「待处理」的语义
      articles = database.all(`
        SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
        FROM articles a
        JOIN bloggers b ON b.id = a.blogger_id
        WHERE a.is_starred = 1
        ORDER BY a.starred_at DESC, a.published_at DESC
        LIMIT 200
      `);
    } else if (topic_id) {
      articles = database.all(`
        SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
        FROM articles a
        JOIN bloggers b ON b.id = a.blogger_id
        JOIN blogger_topics bt ON bt.blogger_id = b.id
        WHERE bt.topic_id = ?
        ORDER BY a.published_at DESC
        LIMIT 200
      `, [topic_id]);
    } else if (blogger_id) {
      articles = database.all(`
        SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
        FROM articles a
        JOIN bloggers b ON b.id = a.blogger_id
        WHERE a.blogger_id = ?
        ORDER BY a.published_at DESC
        LIMIT 200
      `, [blogger_id]);
    } else {
      articles = database.all(`
        SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
        FROM articles a
        JOIN bloggers b ON b.id = a.blogger_id
        ORDER BY a.published_at DESC
        LIMIT 200
      `);
    }

    res.json(articles);
  });

  router.get('/:id', (req, res) => {
    const article = database.get(`
      SELECT a.*, b.name as blogger_name, b.channel_type, b.avatar_color
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      WHERE a.id = ?
    `, [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  });

  // 星标与已读是两回事：标一篇待会儿细看的文章不应该把它标成已读
  router.put('/:id/star', (req, res) => {
    const article = database.get('SELECT is_starred FROM articles WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const next = Number(article.is_starred) ? 0 : 1;
    database.run(
      `UPDATE articles SET is_starred = ?, starred_at = ${next ? "datetime('now','localtime')" : 'NULL'} WHERE id = ?`,
      [next, req.params.id]
    );
    database.save();
    res.json({ id: Number(req.params.id), is_starred: next });
  });

  router.get('/starred/count', (req, res) => {
    const row = database.get('SELECT COUNT(*) AS total FROM articles WHERE is_starred = 1');
    res.json({ total: row?.total || 0 });
  });

  router.put('/:id/read', (req, res) => {
    const article = database.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    database.run('UPDATE articles SET is_read = 1 WHERE id = ?', [req.params.id]);
    database.save();
    res.json({ id: Number(req.params.id), is_read: 1 });
  });

  router.put('/read-all', (req, res) => {
    const { blogger_id } = req.query;
    if (!blogger_id) return res.status(400).json({ error: 'blogger_id is required' });

    const result = database.run('UPDATE articles SET is_read = 1 WHERE blogger_id = ? AND is_read = 0', [blogger_id]);
    database.save();
    res.json({ marked_read: true, count: result.changes });
  });

  router.post('/:id/content', async (req, res) => {
    const article = database.get(`
      SELECT a.*, b.channel_type
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      WHERE a.id = ?
    `, [req.params.id]);

    if (!article) return res.status(404).json({ error: '文章不存在' });
    if (article.content) return res.json({ content: article.content, cached: true });
    if (article.channel_type !== 'wechat') {
      return res.status(400).json({ error: '当前渠道暂不支持正文获取' });
    }

    try {
      const client = createRedfoxClient();
      const data = article.external_id
        ? await client.queryWork({ workUuid: article.external_id })
        : await client.queryArticleDetail({ url: article.url });
      const content = data?.content || null;
      if (content) {
        database.run('UPDATE articles SET content = ? WHERE id = ?', [content, article.id]);
        database.save();
      }
      res.json({ content, cached: false });
    } catch (error) {
      console.error('[content]', { articleId: article.id, error: error.message });
      res.status(502).json({ error: '正文获取失败，请稍后重试' });
    }
  });

  router.post('/:id/summary', async (req, res) => {
    const article = database.get(`
      SELECT a.*, b.channel_type
      FROM articles a
      JOIN bloggers b ON b.id = a.blogger_id
      WHERE a.id = ?
    `, [req.params.id]);

    if (!article) return res.status(404).json({ error: '文章不存在或已被删除' });

    const cached = decodeSummaryCache(article.ai_summary);
    if (cached.current) {
      return res.json({ summary: cached.summary, cached: true });
    }

    if (!summaryAvailable()) {
      return res.status(503).json({ error: '摘要服务尚未配置' });
    }

    const key = String(article.id);
    let generation = inFlight.get(key);
    if (!generation) {
      generation = createSummary(database, summaryGenerator, article)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, generation);
    }

    try {
      const summary = await generation;
      res.json({ summary, cached: false });
    } catch (error) {
      const mapped = mapSummaryError(error);
      console.error('[summary]', {
        articleId: article.id,
        code: error?.code || 'UNKNOWN',
        requestId: error?.requestId || null,
      });
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
}

async function createSummary(database, summaryGenerator, article) {
  const { summary, basedOnDescription } = await summaryGenerator(article);
  const fullSummary = basedOnDescription
    ? `${LIMITED_SOURCE_WARNING}\n\n${summary}`
    : summary;
  database.run('UPDATE articles SET ai_summary = ? WHERE id = ?', [encodeSummaryCache(fullSummary), article.id]);
  database.save();
  return fullSummary;
}

function mapSummaryError(error) {
  switch (error?.code) {
    case 'NOT_CONFIGURED':
    case 'AUTH':
      return { status: 503, message: '摘要服务配置不可用' };
    case 'RATE_LIMIT':
      return { status: 429, message: '摘要请求较多，请稍后重试' };
    case 'TIMEOUT':
      return { status: 504, message: '摘要生成超时，请稍后重试' };
    case 'CONNECTION':
      return { status: 502, message: '暂时无法连接摘要服务' };
    case 'SOURCE_TOO_LONG':
      return { status: 422, message: '内容过长，当前版本暂不能处理' };
    case 'REFUSAL':
      return { status: 422, message: '该内容暂时无法生成摘要' };
    case 'EMPTY_OUTPUT':
    case 'PRIVATE_REASONING_EXPOSED':
    case 'INVALID_FORMAT':
    case 'OUTPUT_TRUNCATED':
    case 'UNEXPECTED_STOP':
      return { status: 502, message: '摘要格式校验失败，请重试' };
    default:
      return { status: 502, message: '摘要服务暂时不可用' };
  }
}

export default createArticlesRouter();
