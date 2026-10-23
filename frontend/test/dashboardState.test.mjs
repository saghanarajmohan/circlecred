import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDashboard } from '../src/dashboardState.ts'

test('dashboard request reports loading then ready data', async () => {
  const states = []
  await loadDashboard(async () => ({ members: 3, collected: 4000 }), state => states.push(state))
  assert.deepEqual(states, [
    { status: 'loading' },
    { status: 'ready', value: { members: 3, collected: 4000 } },
  ])
})

test('dashboard request reports an actionable load error', async () => {
  const states = []
  await loadDashboard(async () => { throw new Error('API unavailable') }, state => states.push(state))
  assert.deepEqual(states, [
    { status: 'loading' },
    { status: 'error', message: 'API unavailable' },
  ])
})
