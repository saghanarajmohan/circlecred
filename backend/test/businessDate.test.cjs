const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessDate, businessPeriod, installmentStatus, parseStoredTimestamp, validDateOnly } = require('../dist/services/businessDate');

test('business calendar follows Asia/Kolkata across midnight, UTC and month transitions', () => {
  assert.equal(businessDate(new Date('2026-10-20T18:29:59.000Z')), '2026-10-20');
  assert.equal(businessDate(new Date('2026-10-20T18:30:00.000Z')), '2026-10-21');
  assert.equal(businessPeriod(new Date('2026-03-31T18:30:00.000Z')), '2026-04');
  assert.equal(businessDate(new Date('2026-01-30T18:30:00.000Z')), '2026-01-31');
  assert.equal(businessDate(new Date('2024-02-28T18:30:00.000Z')), '2024-02-29');
  assert.equal(businessDate(new Date('2025-02-28T18:30:00.000Z')), '2025-03-01');
});

test('installment state changes by date without modifying payment records', () => {
  const deadline = '2026-10-20';
  assert.equal(installmentStatus(1000, 0, deadline, new Date('2026-10-19T18:29:59Z')).status, 'upcoming');
  assert.equal(installmentStatus(1000, 0, deadline, new Date('2026-10-20T06:30:00Z')).status, 'due_today');
  assert.equal(installmentStatus(1000, 0, deadline, new Date('2026-10-20T18:30:00Z')).status, 'overdue');
  assert.deepEqual(installmentStatus(1000, 250, deadline, new Date('2026-10-20T18:30:00Z')), { status: 'partially_paid', timingStatus: 'overdue', remainingAmount: 750 });
  assert.deepEqual(installmentStatus(1000, 1000, deadline, new Date('2026-10-21T18:30:00Z')), { status: 'paid', timingStatus: 'completed', remainingAmount: 0 });
  assert.equal(installmentStatus(1000, 0, '2026-10-21', new Date('2026-10-20T18:29:59Z')).status, 'upcoming');
});

test('date-only values validate leap days, month ends and reject impossible dates', () => {
  assert.equal(validDateOnly('2024-02-29'), true);
  assert.equal(validDateOnly('2026-01-31'), true);
  assert.equal(validDateOnly('2026-04-31'), false);
  assert.equal(validDateOnly('2025-02-29'), false);
});

test('SQLite UTC timestamps are interpreted as UTC before India business-date conversion', () => {
  assert.equal(businessDate(parseStoredTimestamp('2026-10-20 18:29:59')), '2026-10-20');
  assert.equal(businessDate(parseStoredTimestamp('2026-10-20 18:30:00')), '2026-10-21');
});
