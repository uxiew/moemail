/**
 * 单个 isolate 内的近似限流，不写 KV/D1；重启、跨节点或容量淘汰都会重置部分计数。
 * 它只减少后续业务查询，不能替代入口 WAF，也不能限制账号总请求额度。
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()
const MAX_ENTRIES = 10_000

/** 每 5 分钟清理一次过期条目，防止内存泄漏 */
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

/**
 * 检查是否超过速率限制
 * @param key 限流 key（通常是 IP 或 userId + 路由）
 * @param limit 窗口内最大请求数
 * @param windowMs 窗口时长（毫秒）
 * @returns null = 通过；{ retryAfterMs } = 被限流
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { retryAfterMs: number } | null {
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new RangeError('Rate limit and window must be positive integers')
  }
  const now = Date.now()
  cleanup(now)
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.delete(key)
    if (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value
      if (oldest !== undefined) store.delete(oldest)
    }
    store.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }

  if (entry.count >= limit) {
    return { retryAfterMs: entry.resetAt - now }
  }

  entry.count++
  return null
}
