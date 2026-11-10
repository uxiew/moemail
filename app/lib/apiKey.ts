import { createDb } from "./db"
import { apiKeys } from "./schema"
import { eq, and, gt } from "drizzle-orm"
import { auth } from "./auth"
import { headers } from "next/headers"

/**
 * 中间件写入的可信用户 ID header。
 * 中间件会先剔除外部传入的同名 header，再写入验证后的值，所以路由中可以信任它。
 */
export const USER_ID_HEADER = "X-User-Id"

/**
 * 根据 API Key 查询所属用户 ID（只接受已启用且未过期的 Key）
 * @param key 请求头 X-API-Key 的值
 * @returns 用户 ID，无效时返回 undefined
 */
export async function getUserIdByApiKey(key: string): Promise<string | undefined> {
  const db = createDb()
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.key, key),
      eq(apiKeys.enabled, true),
      gt(apiKeys.expiresAt, new Date())
    ),
    columns: { userId: true },
  })

  return apiKey?.userId
}

/**
 * 获取当前请求的用户 ID：优先使用中间件写入的 header，没有时（例如页面渲染）再回退到 session
 */
export const getUserId = async () => {
  const headersList = await headers()
  const userId = headersList.get(USER_ID_HEADER)

  if (userId) return userId

  const session = await auth()

  return session?.user.id
}
