export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
  secretKey: string
}

export interface TurnstileContext {
  hostname: string
  action: 'login' | 'register'
  allowTestKeys?: boolean
}

export interface TurnstileVerificationResult {
  success: boolean
  reason?: 'missing-token' | 'verification-failed' | 'misconfigured'
}

const TEST_SITE_KEYS = new Set(['1x00000000000000000000AA', '2x00000000000000000000AB', '1x00000000000000000000BB', '2x00000000000000000000BB', '3x00000000000000000000FF'])
const TEST_SECRET_KEYS = new Set(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA'])

export function isLocalTurnstileTest(config: TurnstileConfig, context: TurnstileContext) {
  return context.allowTestKeys === true && ['localhost', '127.0.0.1'].includes(context.hostname) &&
    TEST_SITE_KEYS.has(config.siteKey) && TEST_SECRET_KEYS.has(config.secretKey)
}

export function hasTurnstileTestKey(config: TurnstileConfig) {
  return TEST_SITE_KEYS.has(config.siteKey) || TEST_SECRET_KEYS.has(config.secretKey)
}

export async function readTurnstileConfig(store: { get(key: string): Promise<string | null> }): Promise<TurnstileConfig> {
  try {
    const enabled = await store.get('TURNSTILE_ENABLED')
    if (enabled === null || enabled === 'false') return { enabled: false, siteKey: '', secretKey: '' }
    if (enabled !== 'true') return { enabled: true, siteKey: '', secretKey: '' }
    const [site, secret] = await Promise.all(['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'].map(key => store.get(key)))
    return { enabled: true, siteKey: site?.trim() || '', secretKey: secret?.trim() || '' }
  } catch {
    // 不能因配置服务故障而静默关闭已经启用的校验。
    return { enabled: true, siteKey: '', secretKey: '' }
  }
}

export function createTurnstileVerifier() {
  const usedTokens = new Map<string, number>()
  return async (config: TurnstileConfig, token: string | null | undefined, context: TurnstileContext, send: typeof fetch = fetch): Promise<TurnstileVerificationResult> => {
    if (!config.enabled) return { success: true }
    const localTest = isLocalTurnstileTest(config, context)
    if (!config.siteKey || !config.secretKey || !context.hostname || (hasTurnstileTestKey(config) && !localTest)) {
      return { success: false, reason: 'misconfigured' }
    }
    const value = typeof token === 'string' ? token.trim() : ''
    if (!value) return { success: false, reason: 'missing-token' }
    if (value.length > 2048 || (localTest && value !== 'XXXX.DUMMY.TOKEN.XXXX')) return { success: false, reason: 'verification-failed' }
    try {
      if (!localTest) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
        const key = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
        const now = Date.now()
        if ((usedTokens.get(key) || 0) > now) return { success: false, reason: 'verification-failed' }
        usedTokens.delete(key)
        if (usedTokens.size >= 2048) usedTokens.delete(usedTokens.keys().next().value!)
        // Siteverify 的重复识别存在传播延迟；先占用本实例令牌，避免并发重复处理。
        usedTokens.set(key, now + 300_000)
      }
      const response = await send('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(7000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: config.secretKey, response: value }).toString(),
      })
      if (!response.ok) { await response.body?.cancel(); return { success: false, reason: 'verification-failed' } }
      const data = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown }
      const valid = data?.success === true && (localTest || (data.hostname === context.hostname && data.action === context.action))
      return valid ? { success: true } : { success: false, reason: 'verification-failed' }
    } catch {
      return { success: false, reason: 'verification-failed' }
    }
  }
}
