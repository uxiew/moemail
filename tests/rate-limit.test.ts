import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRateLimit } from '../app/lib/rate-limit'

test('fixed windows allow the exact limit and blocked requests do not extend it', t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  assert.equal(checkRateLimit('window-test', 2, 1000), null)
  assert.equal(checkRateLimit('window-test', 2, 1000), null)
  assert.deepEqual(checkRateLimit('window-test', 2, 1000), { retryAfterMs: 1000 })
  now += 500
  assert.deepEqual(checkRateLimit('window-test', 2, 1000), { retryAfterMs: 500 })
  assert.equal(checkRateLimit('other-user', 2, 1000), null)
  now += 500
  assert.equal(checkRateLimit('window-test', 2, 1000), null)
})

test('cardinality is bounded: oldest keys are evicted after 10000 newer identities', () => {
  assert.equal(checkRateLimit('capacity-oldest', 1, 60_000), null)
  for (let i = 0; i < 10_000; i++) checkRateLimit(`capacity-${i}`, 1, 60_000)
  assert.equal(checkRateLimit('capacity-oldest', 1, 60_000), null)
})

test('invalid limits fail explicitly instead of silently disabling throttling', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => checkRateLimit('bad-limit', value, 1000), RangeError)
    assert.throws(() => checkRateLimit('bad-window', 1, value), RangeError)
  }
})

test('periodic expiry cleanup keeps still-active windows', t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  assert.equal(checkRateLimit('expiry-dead', 1, 1000), null)
  assert.equal(checkRateLimit('expiry-live', 1, 600_000), null)
  now += 300_000
  assert.equal(checkRateLimit('expiry-new', 1, 1000), null)
  assert.equal(checkRateLimit('expiry-dead', 1, 1000), null)
  assert.deepEqual(checkRateLimit('expiry-live', 1, 600_000), { retryAfterMs: 300_000 })
})
