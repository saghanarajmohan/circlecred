import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedPool, validateRoundSetup } from '../src/roundMetrics.ts'

test('expected pool uses the fixed target and eligible membership snapshot size', () => {
  assert.equal(expectedPool(2500, 4), 10000)
  assert.equal(expectedPool(0, 4), 0)
  assert.equal(expectedPool(2500, -1), 0)
})

test('round setup validates a positive target and a real deadline in the selected month', () => {
  assert.equal(validateRoundSetup('2026-11', 2500, '2026-11-15'), null)
  assert.match(validateRoundSetup('2026-11', 0, '2026-11-15'), /positive/)
  assert.match(validateRoundSetup('2026-11', 2500, '2026-12-01'), /within the selected month/)
  assert.match(validateRoundSetup('2026-11', 2500, '2026-11-31'), /valid deadline/)
})
