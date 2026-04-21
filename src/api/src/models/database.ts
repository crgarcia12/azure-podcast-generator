import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'generating',
  context_summary TEXT,
  pending_interrupt_id TEXT,
  last_segment_index INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  host_line TEXT NOT NULL,
  guest_line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  revision INTEGER NOT NULL DEFAULT 0,
  generated_after_interrupt TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interrupts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  after_segment_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  input_method TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  interrupt_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id);
CREATE INDEX IF NOT EXISTS idx_interrupts_session ON interrupts(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interrupts_client_req ON interrupts(session_id, client_request_id);
`;

const DROP_ALL = `
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS interrupts;
DROP TABLE IF EXISTS segments;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
`;

function applySchema(database: Database.Database): void {
  database.exec(SCHEMA);
  // Migrations for existing databases
  applyMigrations(database);
}

function applyMigrations(database: Database.Database): void {
  // Add favorite column if missing (for databases created before this migration)
  const cols = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('favorite')) {
    database.exec("ALTER TABLE sessions ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }
}

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? process.env.DB_PATH ?? './data/podcast.db';

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  const database = getDatabase();
  database.exec(DROP_ALL);
  applySchema(database);
}
