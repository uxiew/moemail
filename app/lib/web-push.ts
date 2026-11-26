export interface PushEnv {
  WEB_PUSH_PUBLIC_KEY?: string
  WEB_PUSH_PRIVATE_KEY?: string
  WEB_PUSH_SUBJECT?: string
}

export const MAX_PUSH_DEVICES = 5

export class PushSubscriptionConflictError extends Error {}

export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeKey(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid key encoding')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

export function pushPublicKey(env: PushEnv) {
  try {
    const key = decodeKey(env.WEB_PUSH_PUBLIC_KEY || '')
    return key.length === 65 && key[0] === 4 ? env.WEB_PUSH_PUBLIC_KEY! : null
  } catch { return null }
}

export function validatePushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid push endpoint')
  const url = new URL(value)
  const host = url.hostname
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.pathname.length < 2 || url.href.length > 2048) {
    throw new Error('Unsupported push endpoint')
  }
  return url.href
}

export async function pushSubscriptionId(endpoint: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}

// 仅缓存应用级签名字符串，不跨请求复用 Promise/网络对象，也不缓存订阅或用户数据。
const authorizations = new Map<string, { value: string; expires: number }>()

export async function pushAuthorization(endpoint: string, env: PushEnv, now = Date.now()) {
  const publicKey = pushPublicKey(env)
  if (!publicKey || !env.WEB_PUSH_PRIVATE_KEY || !env.WEB_PUSH_SUBJECT) throw new Error('Push is not configured')
  const subject = new URL(env.WEB_PUSH_SUBJECT)
  if (subject.protocol !== 'https:' || subject.username || subject.password || subject.search || subject.hash) {
    throw new Error('Push subject must be a public HTTPS contact URL')
  }
  const audience = new URL(validatePushEndpoint(endpoint)).origin
  const fingerprint = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.WEB_PUSH_PRIVATE_KEY))))
  const cacheKey = `${publicKey}:${fingerprint}:${subject.href}:${audience}`
  const cached = authorizations.get(cacheKey)
  if (cached && cached.expires > now + 300_000) return cached.value
  const privateKey = await crypto.subtle.importKey('pkcs8', decodeKey(env.WEB_PUSH_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const rawPublic = new Uint8Array([4, ...decodeKey(jwk.x!), ...decodeKey(jwk.y!)])
  if (base64url(rawPublic) !== publicKey) throw new Error('Push key pair does not match')
  const expires = now + 12 * 60 * 60 * 1000
  const encodeJson = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  const token = `${encodeJson({ typ: 'JWT', alg: 'ES256' })}.${encodeJson({ aud: audience, exp: Math.floor(expires / 1000), sub: subject.href })}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(token))
  const value = `vapid t=${token}.${base64url(new Uint8Array(signature))}, k=${publicKey}`
  if (authorizations.size >= 16) authorizations.delete(authorizations.keys().next().value!)
  authorizations.set(cacheKey, { value, expires })
  return value
}

export async function savePushSubscription(db: D1Database, userId: string, endpoint: string, publicKey: string) {
  endpoint = validatePushEndpoint(endpoint)
  const id = await pushSubscriptionId(endpoint)
  const now = Date.now()
  // 单条 SQL 同时限制设备数量和重复提交，避免并发先 count 再 insert 超额。
  const insert = db.prepare(`
    INSERT INTO push_subscription (id, user_id, endpoint, vapid_public_key, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM push_subscription WHERE user_id = ?) < ?
       OR EXISTS (SELECT 1 FROM push_subscription WHERE id = ? AND user_id = ?)
    ON CONFLICT(id) DO UPDATE SET vapid_public_key = excluded.vapid_public_key, updated_at = excluded.updated_at
      WHERE push_subscription.user_id = excluded.user_id
    RETURNING id
  `).bind(id, userId, endpoint, publicKey, now, now, userId, MAX_PUSH_DEVICES, id, userId)
  const result = await db.batch<{ id: string }>([
    db.prepare('DELETE FROM push_subscription WHERE user_id = ? AND vapid_public_key <> ?').bind(userId, publicKey),
    insert,
  ])
  const row = result[1].results[0]
  if (!row) throw new PushSubscriptionConflictError('Device subscription conflict or limit reached')
  return row.id
}

export async function readPushRequest(request: Request): Promise<{ endpoint?: unknown; all?: unknown }> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing request body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) { await reader.cancel(); throw new Error('Request too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected object')
  return data
}

export async function notifyNewMail(db: D1Database, env: PushEnv, userId: string, send: typeof fetch = fetch) {
  const publicKey = pushPublicKey(env)
  if (!publicKey || !env.WEB_PUSH_PRIVATE_KEY || !env.WEB_PUSH_SUBJECT) return
  try {
    const { results } = await db.prepare(
      'SELECT id, endpoint FROM push_subscription WHERE user_id = ? AND vapid_public_key = ? LIMIT ?'
    ).bind(userId, publicKey, MAX_PUSH_DEVICES).all<{ id: string; endpoint: string }>()
    const batchAuthorizations = new Map<string, Promise<string>>()
    await Promise.all(results.map(async row => {
      try {
        const endpoint = validatePushEndpoint(row.endpoint)
        const audience = new URL(endpoint).origin
        let pending = batchAuthorizations.get(audience)
        if (!pending) {
          pending = pushAuthorization(endpoint, env)
          batchAuthorizations.set(audience, pending)
        }
        const authorization = await pending
        for (let attempt = 0; attempt < 2; attempt++) {
          // 空载荷：邮件地址、ID、主题、正文都不会进入推送服务或锁屏文案。
          // Workers 不支持 redirect:error；手动接收 3xx 并拒绝，绝不把鉴权头转发到跳转地址。
          const response = await send(endpoint, {
            method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
            headers: { Authorization: authorization, TTL: '3600', Urgency: 'normal', Topic: 'moemail-new-mail' },
          })
          await response.body?.cancel()
          if (response.status === 404 || response.status === 410) {
            await db.prepare('DELETE FROM push_subscription WHERE id = ? AND user_id = ? AND vapid_public_key = ?')
              .bind(row.id, userId, publicKey).run()
            return
          }
          if (response.ok) return
          if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
            const retryAfter = Number(response.headers.get('Retry-After') || '1')
            if (Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 2) {
              await new Promise(resolve => setTimeout(resolve, Math.max(1, retryAfter) * 1000))
              continue
            }
          }
          console.warn('Web Push delivery rejected', response.status)
          return
        }
      } catch { console.warn('Web Push delivery failed') }
    }))
  } catch { console.warn('Web Push notification unavailable') }
}
