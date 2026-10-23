import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInstallmentAmount, validateInstallmentAmount, validateMemberInvite } from '../src/managementValidation.ts'

test('member invitation form validates contact inputs before submission', () => {
  assert.equal(validateMemberInvite('  Asha Rao ', 'asha@example.test', ''), null)
  assert.match(validateMemberInvite('A', 'asha@example.test', ''), /name/)
  assert.match(validateMemberInvite('Asha Rao', 'bad-email', ''), /email/)
  assert.match(validateMemberInvite('Asha Rao', 'asha@example.test', 'x'.repeat(31)), /Phone/)
})

test('member installments must be positive whole amounts no greater than the outstanding target', () => {
  assert.equal(validateInstallmentAmount(500, 1500), null)
  assert.equal(validateInstallmentAmount('500', 1500), null)
  assert.equal(normalizeInstallmentAmount('500'), 500)
  assert.equal(normalizeInstallmentAmount(''), null)
  assert.equal(validateInstallmentAmount('', 1500), 'Installment must be a positive whole amount.')
  assert.match(validateInstallmentAmount(0, 1500), /positive/)
  assert.match(validateInstallmentAmount(-1, 1500), /positive/)
  assert.match(validateInstallmentAmount(1501, 1500), /remaining/)
  assert.match(validateInstallmentAmount(1.5, 1500), /whole/)
  assert.match(validateInstallmentAmount('1.5', 1500), /whole/)
  assert.match(validateInstallmentAmount(1, Number.NaN), /unavailable/)
})
