import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { AUTH_BODY_LIMIT, AuthBodyTooLargeError, authWriteRule, checkAuthRequest, readAuthBody } from '../app/lib/auth-request'

const request = (path: string, ip: string, extra: Record<string, string> = {}) => new Request(`https://example.com${path}`, { method: 'POST', headers: { 'CF-Connecting-IP': ip, ...extra } })

test('only credential and registration writes are throttled, including encoded and trailing slash forms', () => {
  assert.equal(authWriteRule('/api/auth/callback/creden%74ials/', 'POST')?.key, 'login')
  assert.equal(authWriteRule('/api/auth/register/', 'POST')?.key, 'register')
  for (const path of ['/api/auth/session', '/api/auth/csrf', '/api/auth/callback/github', '/api/auth/signout', '/api/emails/send']) assert.equal(authWriteRule(path, 'POST'), null)
  assert.equal(authWriteRule('/api/auth/register', 'GET'), null)
})

test('login rejects attempt 21 before auth and keeps the NextAuth redirect-false response contract', async () => {
  for (let i = 0; i < 20; i++) assert.equal(checkAuthRequest(request('/api/auth/callback/credentials', '198.51.100.11', { 'X-Forwarded-For': `203.0.113.${i}` })), null)
  const limited = checkAuthRequest(request('/api/auth/callback/credentials', '198.51.100.11'))!
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('Retry-After')) > 0)
  const data = await limited.json() as { url: string }
  assert.equal(new URL(data.url).searchParams.get('code'), 'rate_limited')
  assert.equal(checkAuthRequest(request('/api/auth/callback/credentials', '198.51.100.12')), null)
})

test('registration has its own five-attempt bucket and resets with the window', () => {
  let now = Date.now(); const original = Date.now
  Date.now = () => now
  try {
    for (let i = 0; i < 5; i++) assert.equal(checkAuthRequest(request('/api/auth/register', '198.51.100.13')), null)
    assert.equal(checkAuthRequest(request('/api/auth/register', '198.51.100.13'))?.status, 429)
    assert.equal(checkAuthRequest(request('/api/auth/callback/credentials', '198.51.100.13')), null)
    now += 60_000
    assert.equal(checkAuthRequest(request('/api/auth/register', '198.51.100.13')), null)
  } finally { Date.now = original }
})

test('auth bodies are bounded even without Content-Length and a consumed request can be safely reconstructed', async () => {
  const body = 'username=preview&password=local-only-password'
  const original = new NextRequest('https://example.com/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'local=test' }, body })
  const bytes = await readAuthBody(original)
  const reconstructed = new NextRequest(original.url, { method: original.method, headers: original.headers, body: bytes, signal: original.signal })
  assert.equal(await reconstructed.text(), body)
  assert.equal(reconstructed.headers.get('Cookie'), 'local=test')
  assert.equal((await readAuthBody(new Request('https://example.com', { method: 'POST', body: 'x'.repeat(AUTH_BODY_LIMIT) }))).length, AUTH_BODY_LIMIT)
  await assert.rejects(readAuthBody(new Request('https://example.com', { method: 'POST', body: 'x'.repeat(AUTH_BODY_LIMIT + 1) })), AuthBodyTooLargeError)
  assert.equal(checkAuthRequest(request('/api/auth/callback/credentials', '198.51.100.14', { 'Content-Length': String(AUTH_BODY_LIMIT + 1) }))?.status, 413)
})
