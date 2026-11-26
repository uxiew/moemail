import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, verify } from 'node:crypto'
import { getPlatformProxy } from 'wrangler'
import { base64url, decodeKey, MAX_PUSH_DEVICES, notifyNewMail, pushAuthorization, pushPublicKey, readPushRequest, savePushSubscription, validatePushEndpoint } from '../app/lib/web-push'
import type { PushEnv } from '../app/lib/web-push'
import receiver from '../workers/email-receiver'

let directory: string
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>
let env: PushEnv
let db: D1Database

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  env = {
    WEB_PUSH_PUBLIC_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    WEB_PUSH_PRIVATE_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
    WEB_PUSH_SUBJECT: 'https://example.com/notifications',
  }
  directory = await mkdtemp(join(tmpdir(), 'moemail-push-tests-'))
  const configPath = join(directory, 'wrangler.json')
  await writeFile(configPath, JSON.stringify({ name: 'push-tests', compatibility_date: '2024-03-20', d1_databases: [{ binding: 'DB', database_name: 'push-tests', database_id: '00000000-0000-0000-0000-000000000001' }] }))
  platform = await getPlatformProxy<Env>({ configPath, persist: false, envFiles: [], remoteBindings: false })
  db = platform.env.DB
  for (const file of (await readdir('drizzle')).filter(n => n.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(`drizzle/${file}`, 'utf8')).split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run()
  }
  await db.prepare("INSERT INTO user (id, username) VALUES ('push-user', 'push_user'), ('other-user', 'other_user')").run()
})
after(async () => { await platform?.dispose(); if (directory) await rm(directory, { recursive: true, force: true }) })
beforeEach(async () => { await db.prepare('DELETE FROM push_subscription').run(); await db.prepare('DELETE FROM email').run() })

const endpoint = (id: string) => `https://fcm.googleapis.com/wp/${id}`

test('endpoint validation accepts push providers and rejects arbitrary destinations, credentials and redirects', () => {
  for (const url of [endpoint('a'), 'https://web.push.apple.com/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://wns2.notify.windows.com/w/?token=test']) assert.equal(validatePushEndpoint(url), url)
  for (const url of ['http://fcm.googleapis.com/wp/a', 'https://fcm.googleapis.com.evil.example/wp/a', 'https://127.0.0.1/x', 'https://example.com/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 'https://fcm.googleapis.com/x#fragment', null, 'x'.repeat(2049), endpoint('字'.repeat(800))]) assert.throws(() => validatePushEndpoint(url))
})

test('VAPID token has independently verified ES256 signature, bounded expiry and no email identity', async () => {
  const now = Date.now()
  const header = await pushAuthorization(endpoint('a'), env, now)
  const token = header.match(/^vapid t=(.+), k=/)![1]
  const [head, body, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' })
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.equal(claims.sub, 'https://example.com/notifications')
  assert.equal(claims.exp, Math.floor((now + 12 * 3600_000) / 1000))
  const raw = decodeKey(env.WEB_PUSH_PUBLIC_KEY!)
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: base64url(raw.slice(1, 33)), y: base64url(raw.slice(33)) }, format: 'jwk' })
  assert.equal(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true)
  assert.equal(await pushAuthorization(endpoint('b'), env, now + 1000), header)
  await assert.rejects(pushAuthorization(endpoint('a'), { ...env, WEB_PUSH_PRIVATE_KEY: 'bad-key' }))
  await assert.rejects(pushAuthorization(endpoint('a'), { ...env, WEB_PUSH_SUBJECT: 'mailto:user@example.com' }))
  assert.equal(pushPublicKey({ WEB_PUSH_PUBLIC_KEY: 'invalid' }), null)
})

test('subscription upserts are idempotent, concurrent device limits are atomic and another account cannot take ownership', async () => {
  const key = env.WEB_PUSH_PUBLIC_KEY!
  const first = await savePushSubscription(db, 'push-user', endpoint('a'), key)
  assert.equal(await savePushSubscription(db, 'push-user', endpoint('a'), key), first)
  await assert.rejects(savePushSubscription(db, 'other-user', endpoint('a'), key))
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => savePushSubscription(db, 'push-user', endpoint(`more-${i}`), key)))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, MAX_PUSH_DEVICES - 1)
  assert.equal(await db.prepare('SELECT COUNT(*) FROM push_subscription WHERE user_id = ?').bind('push-user').first('COUNT(*)'), MAX_PUSH_DEVICES)
  assert.equal(await savePushSubscription(db, 'push-user', endpoint('a'), key), first)
})

test('key rotation removes only the current account stale subscriptions', async () => {
  await savePushSubscription(db, 'push-user', endpoint('a'), 'old-key')
  await savePushSubscription(db, 'other-user', endpoint('b'), 'old-key')
  await savePushSubscription(db, 'push-user', endpoint('c'), env.WEB_PUSH_PUBLIC_KEY!)
  assert.equal(await db.prepare('SELECT COUNT(*) FROM push_subscription').first('COUNT(*)'), 2)
})

test('parallel devices on the same provider share one signature within a cold batch', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const cold = { ...env,
    WEB_PUSH_PUBLIC_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    WEB_PUSH_PRIVATE_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
  }
  for (const id of ['cold-a', 'cold-b', 'cold-c']) await savePushSubscription(db, 'push-user', endpoint(id), cold.WEB_PUSH_PUBLIC_KEY)
  const headers: string[] = []
  await notifyNewMail(db, cold, 'push-user', (async (_input: RequestInfo | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get('Authorization')!)
    return new Response(null, { status: 201 })
  }) as typeof fetch)
  assert.equal(headers.length, 3)
  assert.equal(new Set(headers).size, 1)
})

test('sending uses empty bodies, isolates devices and deletes only permanent invalid subscriptions', async () => {
  for (const id of ['ok', 'gone', 'failed']) await savePushSubscription(db, 'push-user', endpoint(id), env.WEB_PUSH_PUBLIC_KEY!)
  await savePushSubscription(db, 'other-user', endpoint('other'), env.WEB_PUSH_PUBLIC_KEY!)
  const seen: string[] = []
  const send = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); seen.push(url)
    assert.equal(init?.body, undefined)
    assert.equal(init?.redirect, 'manual')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('TTL'), '3600')
    assert.ok(headers.get('Authorization')?.startsWith('vapid t='))
    assert.ok(init?.signal instanceof AbortSignal)
    if (url.endsWith('/failed')) throw new DOMException('Synthetic timeout containing private URL', 'TimeoutError')
    return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 })
  }
  await notifyNewMail(db, env, 'push-user', send as typeof fetch)
  assert.equal(seen.length, 3)
  assert.ok(!seen.some(url => url.endsWith('/other')))
  assert.equal(await db.prepare('SELECT COUNT(*) FROM push_subscription').first('COUNT(*)'), 3)
})

test('temporary failures have one bounded retry while disabled configuration does not query storage', async () => {
  await savePushSubscription(db, 'push-user', endpoint('retry'), env.WEB_PUSH_PUBLIC_KEY!)
  let calls = 0
  await notifyNewMail(db, env, 'push-user', (async () => new Response(null, { status: ++calls === 1 ? 503 : 201, headers: { 'Retry-After': '0' } })) as typeof fetch)
  assert.equal(calls, 2)
  await notifyNewMail({ prepare() { throw new Error('Must not query') } } as unknown as D1Database, {}, 'push-user')
})

test('redirects are not followed and provider errors do not disclose endpoints or keys', async t => {
  const warnings = t.mock.method(console, 'warn', () => {})
  await savePushSubscription(db, 'push-user', endpoint('private-token'), env.WEB_PUSH_PUBLIC_KEY!)
  let calls = 0
  await notifyNewMail(db, env, 'push-user', (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++
    assert.equal(init?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })
  }) as typeof fetch)
  assert.equal(calls, 1)
  assert.doesNotMatch(JSON.stringify(warnings.mock.calls.map(call => call.arguments)), /private-token|127\.0\.0\.1|vapid/)
  assert.equal(await db.prepare('SELECT COUNT(*) FROM push_subscription').first('COUNT(*)'), 1)
})

test('deleting a user cascades only that user subscriptions', async () => {
  await db.prepare("INSERT INTO user (id, username) VALUES ('cascade-user', 'cascade_user')").run()
  await savePushSubscription(db, 'cascade-user', endpoint('cascade'), env.WEB_PUSH_PUBLIC_KEY!)
  await savePushSubscription(db, 'other-user', endpoint('keep'), env.WEB_PUSH_PUBLIC_KEY!)
  await db.prepare("DELETE FROM user WHERE id = 'cascade-user'").run()
  assert.equal(await db.prepare('SELECT COUNT(*) FROM push_subscription').first('COUNT(*)'), 1)
})

test('request body parsing is bounded and rejects non-object JSON', async () => {
  assert.deepEqual(await readPushRequest(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ endpoint: endpoint('a') }) })), { endpoint: endpoint('a') })
  for (const body of ['null', '[]', 'invalid', JSON.stringify({ endpoint: 'x'.repeat(5000) })]) await assert.rejects(readPushRequest(new Request('https://example.com', { method: 'POST', body })))
})

test('email arrival schedules push only after a successful insert and notification failure does not lose the email', async t => {
  await db.prepare('INSERT INTO email (id, address, userId, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind('push-mailbox', 'inbox@example.com', 'push-user', Date.now(), Date.now() + 60_000).run()
  await savePushSubscription(db, 'push-user', endpoint('email'), env.WEB_PUSH_PUBLIC_KEY!)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    assert.equal(await db.prepare('SELECT COUNT(*) FROM message').first('COUNT(*)'), 1)
    throw new Error('Synthetic push service failure')
  })
  const pending: Promise<unknown>[] = []
  const message = { to: 'inbox@example.com', from: 'sender@example.com', raw: new Blob(['From: sender@example.com\r\nSubject: do not send\r\n\r\nprivate body']).stream() } as ForwardableEmailMessage
  await receiver.email(message, { ...platform.env, ...env }, { waitUntil(promise: Promise<unknown>) { pending.push(promise) } } as ExecutionContext)
  assert.equal(pending.length, 1)
  await Promise.all(pending)
  assert.equal(calls, 1)
  assert.equal(await db.prepare('SELECT COUNT(*) FROM message').first('COUNT(*)'), 1)
})
