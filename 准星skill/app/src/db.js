import initSqlJs from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, '..', 'data', 'feeds.db');
const DB_PATH = process.env.INFO_SOURCE_DB_PATH
  ? path.resolve(process.env.INFO_SOURCE_DB_PATH)
  : defaultDbPath;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const SQL = await initSqlJs();
const database = fs.existsSync(DB_PATH)
  ? new SQL.Database(fs.readFileSync(DB_PATH))
  : new SQL.Database();

let saveTimer = null;
let transactionDepth = 0;

function persist() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.writeFileSync(DB_PATH, Buffer.from(database.export()));
}

function scheduleSave() {
  if (transactionDepth > 0) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 200);
  saveTimer.unref?.();
}

function run(sql, params = []) {
  database.run(sql, params);
  scheduleSave();
  return { changes: database.getRowsModified() };
}

function all(sql, params = []) {
  const stmt = database.prepare(sql);
  try {
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function exec(sql) {
  database.exec(sql);
  scheduleSave();
}

function transaction(fn) {
  return (...args) => {
    if (transactionDepth > 0) return fn(...args);

    database.exec('BEGIN');
    transactionDepth++;
    try {
      const result = fn(...args);
      if (result && typeof result.then === 'function') {
        throw new TypeError('db.transaction only supports synchronous callbacks');
      }
      database.exec('COMMIT');
      transactionDepth--;
      persist();
      return result;
    } catch (error) {
      transactionDepth--;
      database.exec('ROLLBACK');
      throw error;
    }
  };
}

function save() {
  if (transactionDepth === 0) persist();
}

function close() {
  if (transactionDepth === 0) persist();
  database.close();
}

function hasColumn(table, column) {
  return all(`PRAGMA table_info(${table})`).some(row => row.name === column);
}

function addColumn(table, definition) {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(table, column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

database.exec('PRAGMA foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS bloggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    avatar_color TEXT,
    avatar_url TEXT,
    channel_account TEXT,
    profile_synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_fetched_at TEXT,
    last_fetch_attempted_at TEXT,
    last_fetch_status TEXT DEFAULT 'never',
    last_fetch_error TEXT,
    fetch_cursor TEXT,
    UNIQUE(channel_type, channel_id)
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blogger_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_cn TEXT,
    url TEXT NOT NULL,
    external_id TEXT,
    summary TEXT,
    summary_cn TEXT,
    ai_summary TEXT,
    thumbnail TEXT,
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now','localtime')),
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY (blogger_id) REFERENCES bloggers(id) ON DELETE CASCADE,
    UNIQUE(blogger_id, url)
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '📌',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS blogger_topics (
    blogger_id INTEGER NOT NULL,
    topic_id INTEGER NOT NULL,
    PRIMARY KEY (blogger_id, topic_id),
    FOREIGN KEY (blogger_id) REFERENCES bloggers(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
  );
`);

addColumn('bloggers', 'avatar_url TEXT');
addColumn('bloggers', 'channel_account TEXT');
addColumn('bloggers', 'profile_synced_at TEXT');
addColumn('bloggers', 'last_fetch_attempted_at TEXT');
addColumn('bloggers', "last_fetch_status TEXT DEFAULT 'never'");
addColumn('bloggers', 'last_fetch_error TEXT');
addColumn('bloggers', 'fetch_cursor TEXT');
database.exec("UPDATE bloggers SET last_fetch_status = 'never' WHERE last_fetch_status IS NULL OR last_fetch_status = ''");
addColumn('articles', 'title_cn TEXT');
addColumn('articles', 'summary_cn TEXT');
addColumn('articles', 'external_id TEXT');
addColumn('articles', 'content TEXT');
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS articles_blogger_external_id_unique
  ON articles(blogger_id, external_id)
  WHERE external_id IS NOT NULL AND external_id <> ''
`);
persist();

const PALETTE = [
  'linear-gradient(135deg,#ff6b6b,#ee5a24)',
  'linear-gradient(135deg,#4ecdc4,#2d9b93)',
  'linear-gradient(135deg,#ff0000,#cc0000)',
  'linear-gradient(135deg,#a855f7,#7c3aed)',
  'linear-gradient(135deg,#ffd93d,#f39c12)',
  'linear-gradient(135deg,#74b9ff,#0984e3)',
  'linear-gradient(135deg,#55efc4,#00b894)',
  'linear-gradient(135deg,#fd79a8,#e84393)',
];

export function randomColor(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return PALETTE[sum % PALETTE.length];
}

export { DB_PATH };
export default { run, all, get, exec, transaction, save, close };
