import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Adapter, AdapterUser } from 'next-auth/adapters'
import { isRegistrationEnabled, withRegistrationControl } from '../app/lib/registration'

for (const value of [null, 'false', 'TRUE', '', '1']) {
  test(`registration stays closed for unset or invalid value ${JSON.stringify(value)}`, async () => {
    assert.equal(await isRegistrationEnabled({ get: async () => value }), false)
  })
}

test('only explicit true opens registration; read failures do not fail open', async () => {
  assert.equal(await isRegistrationEnabled({ get: async () => 'true' }), true)
  await assert.rejects(isRegistrationEnabled({ get: async () => { throw new Error('KV unavailable') } }), /KV unavailable/)
})

test('OAuth new-account creation follows the switch without blocking existing users', async () => {
  let enabled = false
  let created = 0
  const user: AdapterUser = { id: 'test-user', email: 'user@example.com', emailVerified: null }
  const adapter: Adapter = {
    createUser: async () => { created++; return user },
    getUser: async () => user,
  }
  const guarded = withRegistrationControl(adapter, { get: async () => String(enabled) })
  await assert.rejects(async () => guarded.createUser!(user), /Registration is disabled/)
  assert.equal(created, 0)
  assert.equal(await guarded.getUser!('test-user'), user)
  enabled = true
  assert.equal(await guarded.createUser!(user), user)
  assert.equal(created, 1)
  enabled = false
  await assert.rejects(async () => guarded.createUser!(user), /Registration is disabled/)
  assert.equal(created, 1)
})
