/**
 * 基于内存的简易 IP 限流。
 *
 * Cloudflare Workers / Pages Functions 的 isolate 有各自独立的内存，
 * 所以这不是严格的全局限流，但已经足够阻止单 IP 暴力刷接口。
 * 如果需要更精确的限流，应该用 Cloudflare WAF Rate Limiting 规则。
 *
 * 设计选择：
 * - 不用 KV（免费 1,000 写/天，一天就打满）
 * - 不用 D1（增加查询开销，违背省额度的目标）
 * - 内存 Map + 定时清理，简单有效
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

/** 每 5 分钟清理一次过期条目，防止内存泄漏 */
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
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
  cleanup()

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }

  entry.count++
  if (entry.count > limit) {
    return { retryAfterMs: entry.resetAt - now }
  }

  return null
}
