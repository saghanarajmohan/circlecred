import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config/env';

let database: DatabaseSync | undefined;

export function openDatabase(path = config.databasePath): DatabaseSync {
  if (database && path === config.databasePath) return database;
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return db;
}

export function getDatabase(): DatabaseSync {
  if (!database) database = openDatabase();
  return database;
}

export function initializeDatabase(db = getDatabase()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','circle_head')),
      password_hash TEXT,
      phone TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS system_bootstrap (
      id INTEGER PRIMARY KEY CHECK(id = 1), initial_head_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS circles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contribution_amount INTEGER NOT NULL CHECK(contribution_amount > 0),
      frequency TEXT NOT NULL DEFAULT 'monthly', due_day INTEGER NOT NULL DEFAULT 12 CHECK(due_day BETWEEN 0 AND 28),
      cycle_count INTEGER NOT NULL DEFAULT 12 CHECK(cycle_count > 0),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','frozen')),
      frozen_at TEXT,
      member_limit INTEGER CHECK(member_limit IS NULL OR member_limit > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), circle_id TEXT NOT NULL REFERENCES circles(id),
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','left')),
      UNIQUE(user_id, circle_id)
    );
    CREATE TABLE IF NOT EXISTS circle_heads (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,circle_id)
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY, membership_id TEXT NOT NULL REFERENCES memberships(id), amount INTEGER NOT NULL CHECK(amount > 0),
      due_date TEXT NOT NULL, paid_at TEXT, status TEXT NOT NULL CHECK(status IN ('pending','successful','failed','delayed')),
      payment_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, contribution_id TEXT REFERENCES contributions(id),
      membership_id TEXT NOT NULL REFERENCES memberships(id), amount INTEGER NOT NULL CHECK(amount > 0),
      status TEXT NOT NULL CHECK(status IN ('pending','successful','failed')), provider TEXT NOT NULL,
      provider_reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES circles(id), recipient_user_id TEXT NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount > 0), cycle_number INTEGER NOT NULL CHECK(cycle_number > 0),
      status TEXT NOT NULL CHECK(status IN ('pending','successful','failed')), paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(circle_id, cycle_number)
    );
    CREATE TABLE IF NOT EXISTS audit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, old_status TEXT, new_status TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reliability_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, membership_id TEXT NOT NULL REFERENCES memberships(id), score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 850),
      factors_json TEXT NOT NULL, calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contribution_rounds (
      id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES circles(id), period TEXT NOT NULL,
      target_amount INTEGER NOT NULL CHECK(target_amount > 0), deadline TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','closed')), started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES users(id), UNIQUE(circle_id,period)
    );
    CREATE TABLE IF NOT EXISTS round_members (
      id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES contribution_rounds(id),
      membership_id TEXT NOT NULL REFERENCES memberships(id), user_id TEXT NOT NULL REFERENCES users(id),
      member_name TEXT NOT NULL, target_amount INTEGER NOT NULL CHECK(target_amount > 0),
      deadline TEXT NOT NULL, UNIQUE(round_id,membership_id)
    );
    CREATE TABLE IF NOT EXISTS member_invites (
      id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES circles(id), name TEXT NOT NULL,
      email TEXT NOT NULL, phone TEXT, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
      expires_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS membership_requests (
      id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES circles(id), user_id TEXT NOT NULL REFERENCES users(id),
      invitation_id TEXT NOT NULL UNIQUE REFERENCES member_invites(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT, decided_by TEXT REFERENCES users(id),
      UNIQUE(circle_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS activation_attempt_limits (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      failed_attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_contributions_membership ON contributions(membership_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payouts_circle ON payouts(circle_id, cycle_number);
    CREATE INDEX IF NOT EXISTS idx_round_members_round ON round_members(round_id);
    CREATE INDEX IF NOT EXISTS idx_invites_circle ON member_invites(circle_id,status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_invite_email ON member_invites(circle_id,email) WHERE status='pending';
  `);

  // Additive migrations keep existing local demo databases usable.
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as {name:string}[];
  if (!userColumns.some(column => column.name === 'role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','circle_head'))");
  if (!userColumns.some(column => column.name === 'password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  const circleColumns = db.prepare('PRAGMA table_info(circles)').all() as {name:string}[];
  if (!circleColumns.some(column => column.name === 'due_day')) db.exec('ALTER TABLE circles ADD COLUMN due_day INTEGER NOT NULL DEFAULT 12 CHECK(due_day BETWEEN 0 AND 28)');
  if (!circleColumns.some(column => column.name === 'status')) db.exec("ALTER TABLE circles ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','frozen'))");
  if (!circleColumns.some(column => column.name === 'frozen_at')) db.exec('ALTER TABLE circles ADD COLUMN frozen_at TEXT');
  if (!circleColumns.some(column => column.name === 'member_limit')) db.exec('ALTER TABLE circles ADD COLUMN member_limit INTEGER CHECK(member_limit IS NULL OR member_limit > 0)');
  const contributionColumns = db.prepare('PRAGMA table_info(contributions)').all() as {name:string}[];
  if (!contributionColumns.some(column => column.name === 'round_member_id')) db.exec('ALTER TABLE contributions ADD COLUMN round_member_id TEXT REFERENCES round_members(id)');
  const version = (db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if (version < 2) {
    // Legacy circles that already have an approved roster or rounds are treated as formed.
    // Newly created circles remain open and cannot acquire approved members except via approval.
    db.exec(`UPDATE circles SET status='frozen', frozen_at=COALESCE(frozen_at, CURRENT_TIMESTAMP)
      WHERE status='open' AND (
        EXISTS(SELECT 1 FROM memberships m WHERE m.circle_id=circles.id AND m.status='active') OR
        EXISTS(SELECT 1 FROM contribution_rounds r WHERE r.circle_id=circles.id)
      );
      PRAGMA user_version = 2;`);
  }
}
