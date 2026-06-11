import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';

mkdirSync(dirname(config.databasePath), { recursive: true });

const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    backend_type TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    credentials_encrypted TEXT NOT NULL,
    credentials_iv TEXT NOT NULL,
    credentials_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at INTEGER,
    snapshot_count INTEGER,
    total_size INTEGER,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    operation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    exit_code INTEGER,
    error_message TEXT,
    log TEXT,
    result TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  );
`);

sqlite.close();
console.log('Database migrated successfully.');
