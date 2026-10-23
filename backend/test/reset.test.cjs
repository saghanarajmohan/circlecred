const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('explicit development reset backs up records and preserves schema while emptying every application table', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'circlecred-reset-'));
  const databasePath = resolve(tempDir, 'local.sqlite');
  const resetScript = resolve(__dirname, '../dist/scripts/resetDatabase.js');
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_PATH: databasePath };
  try {
    const setup = spawnSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const { initializeDatabase } = require(${JSON.stringify(resolve(__dirname, '../dist/services/database.js'))});
      const db = new DatabaseSync(${JSON.stringify(databasePath)});
      db.exec('PRAGMA foreign_keys=ON'); initializeDatabase(db);
      db.prepare('INSERT INTO users(id,name,email,role,password_hash) VALUES(?,?,?,?,?)').run('head-1','Head','head@example.test','circle_head','hashed');
      db.prepare('INSERT INTO circles(id,name,contribution_amount) VALUES(?,?,?)').run('circle-1','Circle',500);
      db.prepare('INSERT INTO circle_heads(user_id,circle_id) VALUES(?,?)').run('head-1','circle-1');
      db.prepare('INSERT INTO memberships(id,user_id,circle_id) VALUES(?,?,?)').run('membership-1','head-1','circle-1');
      db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run('session-hash','head-1','2099-01-01');
      db.prepare('INSERT INTO audit_history(entity_type,entity_id,action) VALUES(?,?,?)').run('circle','circle-1','created');
      db.close();
    `], { cwd: resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);

    const refused = spawnSync(process.execPath, [resetScript], { cwd: resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /No data was changed/);

    const reset = spawnSync(process.execPath, [resetScript, `--confirm-path=${databasePath}`], { cwd: resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(reset.status, 0, reset.stderr);
    assert.match(reset.stdout, /Reset verified: 16 application tables contain zero rows/);
    const backupPath = reset.stdout.match(/^Backup: (.+)$/m)?.[1];
    assert.ok(backupPath && existsSync(backupPath));

    const db = new DatabaseSync(databasePath);
    const backup = new DatabaseSync(backupPath);
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    assert.equal(tableNames.length, 16);
    for (const table of tableNames) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count, 0, `${table} should be empty`);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM memberships').get().count, 1);
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM audit_history').get().count, 1);
    db.close(); backup.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reset refuses production even with explicit path confirmation', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'circlecred-reset-prod-'));
  const databasePath = resolve(tempDir, 'local.sqlite');
  const resetScript = resolve(__dirname, '../dist/scripts/resetDatabase.js');
  try {
    const init = new DatabaseSync(databasePath);
    const { initializeDatabase } = require('../dist/services/database');
    initializeDatabase(init);
    init.close();
    const result = spawnSync(process.execPath, [resetScript, `--confirm-path=${databasePath}`], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: databasePath },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disabled in production/);
    const db = new DatabaseSync(databasePath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
    db.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
