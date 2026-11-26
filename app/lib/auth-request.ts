import { checkRateLimit } from './rate-limit'

export const AUTH_BODY_LIMIT = 32 * 1024
export class AuthBodyTooLargeError extends Error {}

export function authFailureResponse(request: Request, error: string, status: number, code: string, headers?: Record<string, string>) {
  const url = new URL('/zh-CN/login', request.url)
  url.searchParams.set('error', 'CredentialsSignin')
  url.searchParams.set('code', code)
  return Response.json({ error, ...(authWriteRule(new URL(request.url).pathname, request.method)?.key === 'login' ? { url: url.href } : {}) }, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

export function authWriteRule(pathname: string, method: string) {
  if (method !== 'POST') return null
  try { pathname = decodeURIComponent(pathname).replace(/\/+$/, '') } catch { return null }
  if (pathname === '/api/auth/callback/credentials') return { key: 'login', limit: 20 }
  if (pathname === '/api/auth/register') return { key: 'register', limit: 5 }
  return null
}

export function checkAuthRequest(request: Request) {
  const rule = authWriteRule(new URL(request.url).pathname, request.method)
  if (!rule) return null
  const length = request.headers.get('Content-Length')
  if (length && Number(length) > AUTH_BODY_LIMIT) return authFailureResponse(request, '请求过大', 413, 'request_too_large')
  const ip = request.headers.get('CF-Connecting-IP')?.trim()
  const identity = ip && ip.length <= 64 ? ip : 'unknown'
  const limited = checkRateLimit(`auth:${rule.key}:${identity}`, rule.limit, 60_000)
  return limited ? authFailureResponse(request, '尝试过于频繁，请稍后再试', 429, 'rate_limited', {
    'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)),
  }) : null
}

export async function readAuthBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > AUTH_BODY_LIMIT) { await reader.cancel(); throw new AuthBodyTooLargeError('Auth request too large') }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result
}
