import assert from 'node:assert/strict'
import { encode } from 'next-auth/jwt'

const base = new URL(process.env.PREVIEW_URL || 'http://localhost:8788')
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Local preview only')
const secret = process.env.AUTH_SECRET
if (!secret) throw new Error('Set the local preview AUTH_SECRET')
const cookie = async (id: string) => `authjs.session-token=${await encode({ token: { id: `preview-${id}`, sub: `preview-${id}` }, secret, salt: 'authjs.session-token' })}`
const member = await cookie('duke'), other = await cookie('emperor')
let checked = 0
const request = async (expected: number, init: RequestInit = {}) => {
  const response = await fetch(new URL('/api/push', base), init)
  assert.equal(response.status, expected, `Push API status: ${response.status}`)
  checked++
  return response
}
const json = (body: object, method = 'POST', cookies = member): RequestInit => ({
  method, headers: { Origin: base.origin, 'Content-Type': 'application/json', Cookie: cookies }, body: JSON.stringify(body),
})
const status = (cookies = member) => request(200, { headers: { Cookie: cookies } }).then(r => r.json()) as Promise<{ publicKey: string; subscriptions: string[] }>
const endpoint = 'https://fcm.googleapis.com/wp/local-test-only-not-a-real-subscription'
await request(401)
await request(401, { headers: { 'X-User-Id': 'preview-duke', 'x-middleware-subrequest': Array(5).fill('middleware').join(':') } })
await request(403, { headers: { 'X-API-Key': 'preview-only-duke-key' } })
await request(200, json({ all: true }, 'DELETE'))
try {
  assert.ok((await status()).publicKey)
  await request(403, { ...json({ endpoint }), headers: { Cookie: member, 'Content-Type': 'application/json', Origin: 'https://evil.example' } })
  await request(403, { ...json({ endpoint }), headers: { Cookie: member, 'Content-Type': 'application/json' } })
  await request(415, { method: 'POST', headers: { Cookie: member, Origin: base.origin }, body: 'plain text' })
  for (const invalid of ['https://127.0.0.1/private', 'https://fcm.googleapis.com.evil.example/x', '', null]) await request(400, json({ endpoint: invalid }))
  await request(400, json({ endpoint: 'x'.repeat(5000) }))
  const first = await (await request(200, json({ endpoint }))).json() as { id: string }
  assert.equal((await (await request(200, json({ endpoint }))).json() as { id: string }).id, first.id)
  await request(409, json({ endpoint }, 'POST', other))
  await request(200, json({ endpoint }, 'DELETE', other))
  assert.ok((await status()).subscriptions.includes(first.id))
  for (let i = 0; i < 4; i++) await request(200, json({ endpoint: `${endpoint}-${i}` }))
  await request(409, json({ endpoint: `${endpoint}-over-limit` }))
  assert.equal((await status()).subscriptions.length, 5)
  await request(200, json({ endpoint }, 'DELETE'))
  await request(200, json({ endpoint }, 'DELETE'))
  assert.equal((await status()).subscriptions.length, 4)
} finally {
  await request(200, json({ all: true }, 'DELETE'))
}
assert.equal((await status()).subscriptions.length, 0)
console.log(`Local push API checks passed: ${checked}`)
