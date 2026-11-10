import assert from 'node:assert/strict'
import { encode } from 'next-auth/jwt'

const base = new URL(process.env.PREVIEW_URL || 'http://localhost:3000')
if (!['localhost', '127.0.0.1'].includes(base.hostname) || !process.env.AUTH_SECRET) {
  throw new Error('Only a local preview with AUTH_SECRET is supported')
}
const session = async (role: string) => `authjs.session-token=${await encode({
  secret: process.env.AUTH_SECRET!, salt: 'authjs.session-token',
  token: { id: `preview-${role}`, sub: `preview-${role}`, name: '本地测试用户' },
})}`
const admin = await session('emperor')
const member = await session('duke')
let checked = 0
async function check(path: string, expected: number, init: RequestInit = {}) {
  const response = await fetch(new URL(path, base), { ...init, redirect: 'manual' })
  assert.equal(response.status, expected, `${init.method || 'GET'} ${path}`)
  checked++
  return response
}
const json = (body: unknown, cookie?: string): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
})

// 先编译开发模式的分享路由；首次编译会重建 middleware isolate。
// 用独立的模拟 Cloudflare IP，避免预热和浏览器操作占用被测窗口。
const ipTag = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
const sharedIp = `2001:db8::${ipTag.slice(0, 4)}:${ipTag.slice(4)}`
const warmup = await check('/api/shared/preview-share-token/messages', 200, {
  headers: { 'CF-Connecting-IP': `2001:db8:1::${ipTag.slice(0, 4)}:${ipTag.slice(4)}` },
})
await warmup.arrayBuffer()
await check('/api/emails', 401)
await check('/api/emails', 401, { headers: { 'X-User-Id': 'preview-duke', 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' } })
await check('/api/emails', 401, { headers: { 'X-User-Id': 'preview-emperor' } })
const own = await (await check('/api/emails', 200, { headers: { Cookie: member, 'X-User-Id': 'preview-emperor' } })).json() as { emails: { userId: string }[] }
assert.ok(own.emails.length > 0)
assert.ok(own.emails.every(email => email.userId === 'preview-duke'))
await check('/api/emails/preview-mailbox-0', 403, { headers: { Cookie: await session('knight') } })
await check('/api/emails', 401, { headers: { 'X-API-Key': 'invalid-local-preview-key' } })
await check('/api/emails', 200, { headers: { 'X-API-Key': 'preview-only-duke-key' } })
await check('/api/roles/users', 403, json({ searchText: 'preview_duke' }, member))
await check('/api/roles/users', 200, json({ searchText: 'preview_duke' }, admin))
await check('/api/config', 403, json({ registrationEnabled: true }, member))
await check('/api/config', 403, { ...json({ registrationEnabled: true }), headers: { 'Content-Type': 'application/json', 'X-API-Key': 'preview-only-duke-key' } })
const original = await (await check('/api/config', 200, { headers: { Cookie: admin } })).json() as Record<string, unknown>
try {
  const closed = { ...original, registrationEnabled: false }
  await check('/api/config', 200, json(closed, admin))
  await check('/api/auth/register', 403, json({ username: 'closed_test', password: 'LocalOnlyPassword123' }))
  await check('/api/config', 400, json({ ...closed, registrationEnabled: 'false' }, admin))
  await check('/api/config', 200, json({ ...original, registrationEnabled: true }, admin))
  const legacy = { ...original }
  delete legacy.registrationEnabled
  await check('/api/config', 200, json(legacy, admin))
  const saved = await (await check('/api/config', 200, { headers: { Cookie: admin } })).json() as { registrationEnabled: boolean }
  assert.equal(saved.registrationEnabled, true)
  await check('/api/auth/register', 400, json({ username: '', password: 'short' }))
  const username = `test_${Date.now().toString(36)}`
  const registration = await (await check('/api/auth/register', 200, json({ username, password: 'LocalOnlyPassword123' }))).json() as { user: Record<string, unknown> }
  assert.equal('password' in registration.user, false)
  await check('/api/auth/register', 409, json({ username, password: 'LocalOnlyPassword123' }))
  await check('/api/config', 200, json(closed, admin))
  await check('/api/auth/register', 403, json({ username: 'closed_again', password: 'LocalOnlyPassword123' }))
  await check('/api/emails', 200, { headers: { Cookie: member } })

  const csrf = await fetch(new URL('/api/auth/csrf', base))
  const { csrfToken } = await csrf.json() as { csrfToken: string }
  const cookies = csrf.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
  const login = await fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1', Cookie: cookies },
    body: new URLSearchParams({ csrfToken, username: 'preview_duke', password: 'LocalPreviewOnly123!', callbackUrl: new URL('/zh-CN/moe', base).toString() }),
  })
  const result = await login.json() as { url: string }
  assert.ok(!result.url.includes('error='), result.url)
  assert.ok(login.headers.getSetCookie().some(cookie => cookie.startsWith('authjs.session-token=')))
  checked++
} finally {
  await check('/api/config', 200, json(original, admin))
}
// 另用未参与权限流程的账号测限流，不影响管理员的配置恢复。
const limitedUser = await session('civilian')
for (let i = 0; i < 60; i++) await check('/api/config', 200, { headers: { Cookie: limitedUser } })
const throttled = await check('/api/config', 429, { headers: { Cookie: limitedUser } })
assert.ok(Number(throttled.headers.get('retry-after')) > 0)
assert.ok(Number(throttled.headers.get('retry-after')) <= 60)
// 变化的 X-Forwarded-For 不能给公开分享接口重置同一来源的窗口。
for (let i = 0; i < 30; i++) {
  await check('/api/shared/preview-share-token/messages', 200, { headers: { 'CF-Connecting-IP': sharedIp, 'X-Forwarded-For': `198.51.100.${i + 1}` } })
}
const sharedThrottle = await check('/api/shared/preview-share-token/messages', 429, { headers: { 'CF-Connecting-IP': sharedIp, 'X-Forwarded-For': '203.0.113.200' } })
assert.ok(Number(sharedThrottle.headers.get('retry-after')) > 0)
console.log(`Local API checks passed: ${checked}`)
