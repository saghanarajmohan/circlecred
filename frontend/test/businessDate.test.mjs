import { test } from 'node:test'
import assert from 'node:assert/strict'
import { businessDate, businessPeriod, dateLabel, formatBusinessDate, parseStoredTimestamp } from '../src/businessDate.ts'

test('frontend business date uses Asia/Kolkata even when system timezone is different', () => {
  assert.equal(businessDate(new Date('2026-10-20T18:29:59Z')), '2026-10-20')
  assert.equal(businessDate(new Date('2026-10-20T18:30:00Z')), '2026-10-21')
  assert.equal(businessPeriod(new Date('2026-03-31T18:30:00Z')), '2026-04')
})

test('date-only deadlines format without shifting to another calendar day', () => {
  assert.match(formatBusinessDate('2024-02-29'), /29/)
  assert.match(formatBusinessDate('2026-01-31'), /31/)
  assert.match(dateLabel('2026-10-20'), /20/)
})

test('SQLite timestamp text is parsed as UTC before applying the business timezone', () => {
  assert.equal(businessDate(parseStoredTimestamp('2026-10-20 18:30:00')), '2026-10-21')
})
