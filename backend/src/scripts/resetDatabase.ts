import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { config } from '../config/env';

const tablesInDeleteOrder = [
  'activation_attempt_limits',
  'auth_sessions',
  'reliability_scores',
  'payments',
  'contributions',
  'round_members',
  'contribution_rounds',
  'payouts',
  'membership_requests',
  'member_invites',
  'memberships',
  'circle_heads',
  'audit_history',
  'system_bootstrap',
  'circles',
  'users',
] as const;

function backupFilePath(databasePath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const stem = basename(databasePath, '.sqlite');
  for (let suffix = 0; ; suffix++) {
    const candidate = join(dirname(databasePath), `${stem}.backup-${stamp}${suffix ? `-${suffix}` : ''}.sqlite`);
    if (!existsSync(candidate)) return candidate;
  }
}

function quoteSqlPath(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function resetDatabase(): void {
  const configuredPath = config.databasePath;
  if (configuredPath === ':memory:') throw new Error('Refusing to reset an in-memory database.');
  const databasePath = resolve(configuredPath);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Resolved SQLite database: ${databasePath}`);

  if (config.nodeEnv.toLowerCase() === 'production') throw new Error('Database reset is disabled in production.');
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) throw new Error('The configured SQLite database file does not exist; refusing to create or reset a different file.');

  const confirmation = process.argv.slice(2).find(value => value.startsWith('--confirm-path='))?.slice('--confirm-path='.length);
  if (confirmation !== databasePath) {
    throw new Error(`No data was changed. Confirm this exact file by rerunning with --confirm-path="${databasePath}".`);
  }

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  const presentTables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row => row.name));
  const missing = tablesInDeleteOrder.filter(table => !presentTables.has(table));
  const unexpected = [...presentTables].filter(table => !tablesInDeleteOrder.includes(table as typeof tablesInDeleteOrder[number]));
  if (missing.length || unexpected.length) {
    db.close();
    throw new Error(`Database schema does not match the reset table inventory (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}); no data was changed.`);
  }

  const backupPath = backupFilePath(databasePath);
  let transactionOpen = false;
  try {
    // Hold SQLite's write reservation while copying and clearing so application writes
    // cannot slip between the backup snapshot and the reset transaction.
    db.exec('BEGIN IMMEDIATE;');
    transactionOpen = true;
    const backupDb = new DatabaseSync(databasePath);
    try {
      backupDb.exec(`VACUUM INTO ${quoteSqlPath(backupPath)};`);
    } finally {
      backupDb.close();
    }

    for (const table of tablesInDeleteOrder) db.exec(`DELETE FROM "${table}";`);
    db.exec("DELETE FROM sqlite_sequence WHERE name='audit_history';");

    const remaining = Object.fromEntries(tablesInDeleteOrder.map(table => [table, (db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {count:number}).count]));
    const nonEmpty = Object.entries(remaining).filter(([, count]) => count !== 0);
    if (nonEmpty.length) throw new Error(`Reset verification failed: ${JSON.stringify(nonEmpty)}.`);

    db.exec('COMMIT;');
    transactionOpen = false;
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error(`Foreign-key verification failed: ${foreignKeyErrors.length} issue(s).`);
    const indexCount = (db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index'").get() as {count:number}).count;
    const schemaVersion = (db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
    console.log(`Backup: ${backupPath}`);
    console.log(`Reset verified: ${tablesInDeleteOrder.length} application tables contain zero rows.`);
    console.log(`Schema version preserved: ${schemaVersion}; indexes present: ${indexCount}; foreign-key errors: 0.`);
    console.log(JSON.stringify({tables:remaining}, null, 2));
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK;'); } catch { /* SQLite may already have closed the transaction. */ }
    }
    throw error;
  } finally {
    db.close();
  }
}

try {
  resetDatabase();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database reset failed.');
  process.exitCode = 1;
}
