import assert from 'node:assert/strict'
import { encode } from 'next-auth/jwt'

const base = new URL(process.env.PREVIEW_URL || 'http://localhost:8795')
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Local preview only')
const secret = process.env.AUTH_SECRET
if (!secret) throw new Error('Set local AUTH_SECRET')
const admin = `authjs.session-token=${await encode({ token: { id: 'preview-emperor', sub: 'preview-emperor' }, secret, salt: 'authjs.session-token' })}`
let checks = 0
const check = async (path: string, status: number, init: RequestInit = {}) => {
  const response = await fetch(new URL(path, base), init)
  assert.equal(response.status, status, `${path} expected ${status}, received ${response.status}`)
  checks++
  return response
}
const original = await (await check('/api/config', 200, { headers: { Cookie: admin } })).json() as Record<string, unknown>
const save = (body: object) => check('/api/config', 200, { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const turnstile = { enabled: true, siteKey: '1x00000000000000000000AA', secretKey: '1x0000000000000000000000000000000AA' }
const data = { ...original, registrationEnabled: true, turnstile }
const register = (body: object, ip: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) })
const credentials = async (token?: string) => {
  const csrf = await fetch(new URL('/api/auth/csrf', base))
  const { csrfToken } = await csrf.json() as { csrfToken: string }
  const cookies = csrf.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  return fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1', Cookie: cookies, 'CF-Connecting-IP': '198.51.100.41' },
    body: new URLSearchParams({ username: 'preview_duke', password: 'LocalPreviewOnly123!', csrfToken, ...(token ? { turnstileToken: token } : {}) }),
  })
}
try {
  await save(data)
  const legacy = { ...data } as Record<string, unknown>; delete legacy.turnstile
  await save(legacy)
  const saved = await (await check('/api/config', 200, { headers: { Cookie: admin } })).json() as { turnstile: typeof turnstile }
  assert.deepEqual(saved.turnstile, turnstile)
  await check('/api/config', 400, { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, turnstile: { ...turnstile, enabled: 'true' } }) })
  await check('/api/auth/register', 400, register({ username: 'missing_token', password: 'LocalOnlyPassword123' }, '198.51.100.40'))
  await check('/api/auth/register', 400, register({ username: 'invalid_token', password: 'LocalOnlyPassword123', turnstileToken: 'not-a-token' }, '198.51.100.40'))
  const denied = await (await credentials()).json() as { url: string }
  assert.equal(new URL(denied.url).searchParams.get('code'), 'security_verification_failed'); checks++
  const login = await credentials('XXXX.DUMMY.TOKEN.XXXX')
  const loginData = await login.json() as { url: string }
  assert.equal(new URL(loginData.url).searchParams.has('error'), false, 'Valid dummy challenge should authenticate only in explicit local test mode')
  assert.ok(login.headers.getSetCookie().some(value => value.startsWith('authjs.session-token='))); checks++
  await check('/api/auth/register', 200, register({ username: `cap_${Date.now().toString(36)}`, password: 'LocalOnlyPassword123', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }, '198.51.100.40'))
  for (let i = 0; i < 5; i++) await check('/api/auth/register', 400, register({}, '198.51.100.42'))
  const blocked = await check('/api/auth/register', 429, register({}, '198.51.100.42'))
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0)
  await check('/api/auth/callback/credentials', 413, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '198.51.100.43' }, body: 'x'.repeat(32769) })
} finally {
  await save(original)
}
console.log(`Local auth security checks passed: ${checks}`)
