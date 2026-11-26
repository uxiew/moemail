import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTurnstileVerifier, readTurnstileConfig } from '../app/lib/turnstile-validation'

const config = { enabled: true, siteKey: 'real-site-key', secretKey: 'private-test-secret' }
const context = { hostname: 'mail.example.com', action: 'login' as const }
const reply = (data: unknown, status = 200) => (async () => Response.json(data, { status })) as typeof fetch
const pass = { success: true, hostname: context.hostname, action: context.action }

test('disabled captcha reads only the flag; invalid flags and storage errors fail closed', async () => {
  const seen: string[] = []
  assert.deepEqual(await readTurnstileConfig({ async get(key) { seen.push(key); return 'false' } }), { enabled: false, siteKey: '', secretKey: '' })
  assert.deepEqual(seen, ['TURNSTILE_ENABLED'])
  assert.equal((await readTurnstileConfig({ async get() { return null } })).enabled, false)
  assert.deepEqual(await readTurnstileConfig({ async get() { return 'TRUE' } }), { enabled: true, siteKey: '', secretKey: '' })
  assert.deepEqual(await readTurnstileConfig({ async get() { throw new Error('KV unavailable') } }), { enabled: true, siteKey: '', secretKey: '' })
})

test('enabled config trims keys and never bypasses verification when a key is absent', async () => {
  const values: Record<string, string> = { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: ' site ', TURNSTILE_SECRET_KEY: ' secret ' }
  assert.deepEqual(await readTurnstileConfig({ async get(key) { return values[key] } }), { enabled: true, siteKey: 'site', secretKey: 'secret' })
  for (const field of ['siteKey', 'secretKey']) {
    const result = await createTurnstileVerifier()({ ...config, [field]: '' }, 'token', context, reply(pass))
    assert.deepEqual(result, { success: false, reason: 'misconfigured' })
  }
})

test('absent or oversized tokens are rejected before contacting the provider', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; return Response.json(pass) }) as typeof fetch
  for (const token of [undefined, null, '', ' ', 'x'.repeat(2049)]) assert.equal((await createTurnstileVerifier()(config, token, context, fetcher)).success, false)
  assert.equal(calls, 0)
  assert.equal((await createTurnstileVerifier()({ ...config, enabled: false }, null, context, fetcher)).success, true)
})

test('siteverify request contains only secret and opaque token, has a timeout and does not follow redirects', async () => {
  const fetcher = (async (url, init) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal)
    const body = new URLSearchParams(String(init?.body))
    assert.deepEqual([...body.keys()].sort(), ['response', 'secret'])
    assert.equal(body.get('response'), 'token')
    assert.equal(body.get('secret'), config.secretKey)
    return Response.json(pass)
  }) as typeof fetch
  assert.equal((await createTurnstileVerifier()(config, ' token ', context, fetcher)).success, true)
})

test('only boolean success with matching hostname and action is accepted', async () => {
  for (const response of [{ ...pass, success: 'true' }, { ...pass, success: false }, { ...pass, hostname: 'evil.example' }, { ...pass, action: 'register' }, { success: true }, null]) {
    assert.equal((await createTurnstileVerifier()(config, 'token', context, reply(response))).success, false)
  }
  assert.equal((await createTurnstileVerifier()(config, 'token', context, reply(pass))).success, true)
})

test('timeouts, non-JSON responses and upstream errors reject without logging secrets', async t => {
  const logged = t.mock.method(console, 'error')
  for (const fetcher of [reply(pass, 500), reply(pass, 302), (async () => new Response('bad json')) as typeof fetch, (async () => { throw new DOMException('timeout', 'TimeoutError') }) as typeof fetch]) {
    assert.equal((await createTurnstileVerifier()(config, 'token', context, fetcher)).success, false)
  }
  assert.equal(logged.mock.callCount(), 0)
})

test('parallel and subsequent replay in the same instance contact siteverify only once', async () => {
  const verify = createTurnstileVerifier()
  let calls = 0
  const fetcher = (async () => { calls++; return Response.json(pass) }) as typeof fetch
  const results = await Promise.all(Array.from({ length: 8 }, () => verify(config, 'single-use-token', context, fetcher)))
  assert.equal(results.filter(r => r.success).length, 1)
  assert.equal(calls, 1)
  assert.equal((await verify(config, 'single-use-token', context, fetcher)).success, false)
})

test('replay memory is bounded and expired entries do not live forever', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now)
  const verify = createTurnstileVerifier()
  assert.equal((await verify(config, 'first-token', context, reply(pass))).success, true)
  for (let i = 0; i < 2048; i++) await verify(config, `capacity-${i}`, context, reply(pass))
  assert.equal((await verify(config, 'first-token', context, reply(pass))).success, true)
  assert.equal((await verify(config, 'first-token', context, reply(pass))).success, false)
  now += 300_000
  assert.equal((await verify(config, 'first-token', context, reply(pass))).success, true)
})

test('official dummy keys require both an explicit test flag and loopback; production never accepts them', async () => {
  const dummy = { enabled: true, siteKey: '1x00000000000000000000AA', secretKey: '1x0000000000000000000000000000000AA' }
  const token = 'XXXX.DUMMY.TOKEN.XXXX'
  for (const ctx of [context, { ...context, allowTestKeys: true }, { ...context, hostname: 'localhost' }]) {
    assert.equal((await createTurnstileVerifier()(dummy, token, ctx, reply(pass))).success, false)
  }
  const ctx = { ...context, hostname: 'localhost', allowTestKeys: true }
  assert.equal((await createTurnstileVerifier()(dummy, token, ctx, reply({ success: true, hostname: 'dummy-key-pass', action: 'test' }))).success, true)
  assert.equal((await createTurnstileVerifier()(dummy, 'arbitrary-token', ctx, reply(pass))).success, false)
})
