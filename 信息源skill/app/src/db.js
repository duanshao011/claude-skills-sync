import initSqlJs from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'feeds.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
let saveTimer = null;

// Load or create database
const SQL = await initSqlJs();
if (fs.existsSync(DB_PATH)) {
  const buffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(buffer);
} else {
  db = new SQL.Database();
}

// Enable WAL-like behavior via manual save
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  }, 200);
}

// Run a SQL statement and return the db object (for chaining)
function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
  return { changes: db.getRowsModified() };
}

// Query multiple rows
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Query single row
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Execute multiple statements
function exec(sql) {
  db.exec(sql);
  scheduleSave();
}

// Wrap operations in a transaction
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      scheduleSave();
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

// Save manually (call before important operations)
function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS bloggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    avatar_color TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_fetched_at TEXT,
    UNIQUE(channel_type, channel_id)
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blogger_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
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
scheduleSave();

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

export default { run, all, get, exec, transaction, save };
