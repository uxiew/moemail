import { auth } from '@/lib/auth'
import { getRequestContext } from '@cloudflare/next-on-pages'
import { MAX_PUSH_DEVICES, PushSubscriptionConflictError, pushPublicKey, readPushRequest, savePushSubscription, validatePushEndpoint } from '@/lib/web-push'

export const runtime = 'edge'

const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function user(request: Request) {
  // 订阅绑定登录会话，而非可伪造的用户头；API Key 不允许控制浏览器推送。
  if (request.headers.has('X-API-Key')) return null
  return (await auth())?.user?.id ?? null
}

export async function GET(request: Request) {
  const userId = await user(request)
  if (!userId) return json({ error: '未登录' }, 401)
  const env = getRequestContext().env
  const publicKey = pushPublicKey(env)
  if (!publicKey) return json({ publicKey: null, subscriptions: [], maxDevices: MAX_PUSH_DEVICES })
  try {
    const { results } = await env.DB.prepare('SELECT id FROM push_subscription WHERE user_id = ? AND vapid_public_key = ?')
      .bind(userId, publicKey).all<{ id: string }>()
    return json({ publicKey, subscriptions: results.map(row => row.id), maxDevices: MAX_PUSH_DEVICES })
  } catch { return json({ error: '通知服务暂时不可用' }, 503) }
}

async function change(request: Request, remove: boolean) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: '请求来源不匹配' }, 403)
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: '需要 JSON 请求' }, 415)
  const userId = await user(request)
  if (!userId) return json({ error: '未登录' }, 401)
  let endpoint = ''
  let all = false
  try {
    const data = await readPushRequest(request)
    all = remove && data.all === true
    if (!all) endpoint = validatePushEndpoint(data.endpoint)
  } catch { return json({ error: '无效或不支持的推送订阅' }, 400) }
  const env = getRequestContext().env
  try {
    if (remove) {
      if (all) await env.DB.prepare('DELETE FROM push_subscription WHERE user_id = ?').bind(userId).run()
      else await env.DB.prepare('DELETE FROM push_subscription WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run()
      return json({ success: true })
    }
    const publicKey = pushPublicKey(env)
    if (!publicKey) return json({ error: '管理员尚未配置推送服务' }, 503)
    const id = await savePushSubscription(env.DB, userId, endpoint, publicKey)
    return json({ id })
  } catch (error) {
    return error instanceof PushSubscriptionConflictError
      ? json({ error: '订阅失败，请检查设备数量或先清理旧订阅' }, 409)
      : json({ error: '通知服务暂时不可用，请稍后重试' }, 503)
  }
}

export const POST = (request: Request) => change(request, false)
export const DELETE = (request: Request) => change(request, true)
