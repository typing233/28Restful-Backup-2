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
    context TEXT,
    exit_code INTEGER,
    error_message TEXT,
    log TEXT,
    result TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_plans (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    cron_expression TEXT NOT NULL,
    paths TEXT NOT NULL,
    excludes TEXT,
    tags TEXT,
    retention_policy TEXT,
    max_file_count INTEGER,
    max_bytes INTEGER,
    one_file_system INTEGER NOT NULL DEFAULT 0,
    exclude_larger_than TEXT,
    pre_hook TEXT,
    post_hook TEXT,
    last_run_at INTEGER,
    last_run_status TEXT,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_plan_runs (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES backup_plans(id),
    task_id TEXT REFERENCES tasks(id),
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    snapshot_id TEXT,
    files_new INTEGER,
    files_changed INTEGER,
    files_unmodified INTEGER,
    bytes_added INTEGER,
    bytes_processed INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    retention_applied INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS restore_jobs (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    task_id TEXT REFERENCES tasks(id),
    snapshot_id TEXT NOT NULL,
    source_paths TEXT NOT NULL,
    target_path TEXT NOT NULL,
    conflict_strategy TEXT NOT NULL DEFAULT 'overwrite',
    include_patterns TEXT,
    exclude_patterns TEXT,
    verify_after INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    files_restored INTEGER,
    bytes_restored INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  );
`);

sqlite.close();
console.log('Database migrated successfully.');
