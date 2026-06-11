import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const repos = sqliteTable('repos', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  backendType: text('backend_type').notNull(),
  repoUrl: text('repo_url').notNull(),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  credentialsIv: text('credentials_iv').notNull(),
  credentialsTag: text('credentials_tag').notNull(),
  status: text('status').notNull().default('unknown'),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
  snapshotCount: integer('snapshot_count'),
  totalSize: integer('total_size'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull().references(() => repos.id),
  userId: text('user_id').notNull().references(() => users.id),
  operation: text('operation').notNull(),
  status: text('status').notNull().default('queued'),
  exitCode: integer('exit_code'),
  errorMessage: text('error_message'),
  log: text('log'),
  result: text('result'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
