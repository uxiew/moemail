import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { i18n, type Locale } from "@/i18n/config"
import { PERMISSIONS, hasPermission, type Permission, type Role } from "@/lib/permissions"
import { checkPermission } from "@/lib/auth"
import { getUserIdByApiKey, USER_ID_HEADER } from "@/lib/apiKey"
import { checkRateLimit } from "@/lib/rate-limit"
import { checkAuthRequest } from '@/lib/auth-request'

const API_PERMISSIONS: Record<string, Permission> = {
  '/api/emails': PERMISSIONS.MANAGE_EMAIL,
  '/api/webhook': PERMISSIONS.MANAGE_WEBHOOK,
  '/api/roles/promote': PERMISSIONS.PROMOTE_USER,
  '/api/roles/users': PERMISSIONS.PROMOTE_USER,
  '/api/config': PERMISSIONS.MANAGE_CONFIG,
  '/api/api-keys': PERMISSIONS.MANAGE_API_KEY,
}

/** 无需登录的 API：认证接口、分享接口（由路由内部校验分享 token） */
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/shared']

/** API Key 只允许访问的接口前缀 */
const API_KEY_PREFIXES = ['/api/emails', '/api/config']

const json = (error: string, status: number, extraHeaders?: Record<string, string>) => {
  return NextResponse.json({ error }, { status, headers: extraHeaders })
}

/** 从请求中提取客户端 IP（Cloudflare 会设置 CF-Connecting-IP） */
function getClientIp(request: Request): string {
  // 不把任意客户端提供的 X-Forwarded-For 当作可信限流身份。
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  return ip && ip.length <= 64 ? ip : 'unknown'
}

export async function middleware(request: Request) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // 安全：外部传入的 X-User-Id 一律剔除。
  // 只改 request.headers 不会传到下游，必须通过 NextResponse.next({ request: { headers } }) 传递，
  // 所以这里统一构造净化后的 headers。
  const headers = new Headers(request.headers)
  headers.delete(USER_ID_HEADER)
  const next = () => NextResponse.next({ request: { headers } })

  if (pathname.startsWith('/api')) {
    const authLimited = checkAuthRequest(request)
    if (authLimited) return authLimited
    if (PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
      // 公开接口（分享页轮询等）按 IP 限流：30 次/分钟
      if (pathname.startsWith('/api/shared')) {
        const ip = getClientIp(request)
        const limited = checkRateLimit(`share:${ip}`, 30, 60_000)
        if (limited) {
          return json("请求过于频繁，请稍后再试", 429, {
            'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000))
          })
        }
      }
      return next()
    }

    // 只解析一次用户身份，并把 userId 通过 header 传给路由，
    // 路由里的 getUserId() 就不用再调用 auth()（每次 auth() 都要解密 JWT 并查询 D1）
    let userId: string | undefined
    let roles: Role[] | undefined

    const apiKey = headers.get("X-API-Key")
    if (apiKey) {
      if (!API_KEY_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
        return json("无权限查看", 403)
      }
      userId = await getUserIdByApiKey(apiKey)
      if (!userId) return json("无效的 API Key", 401)
    } else {
      const session = await auth()
      userId = session?.user?.id
      if (!userId) return json("未授权", 401)
      // session 回调里已经查过角色，直接复用，避免再查一次 D1
      roles = session?.user?.roles?.map(r => r.name as Role)
    }

    headers.set(USER_ID_HEADER, userId)

    // 按用户减少后续业务查询；本次认证和 Functions 请求仍计入额度
    // 创建邮箱：10 次/分钟；其他 API：60 次/分钟
    const rateKey = pathname.startsWith('/api/emails/generate')
      ? `gen:${userId}`
      : `api:${userId}`
    const rateLimit = pathname.startsWith('/api/emails/generate') ? 10 : 60
    const limited = checkRateLimit(rateKey, rateLimit, 60_000)
    if (limited) {
      return json("请求过于频繁，请稍后再试", 429, {
        'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000))
      })
    }

    if (pathname === '/api/config' && request.method === 'GET') {
      return next()
    }

    const route = Object.keys(API_PERMISSIONS).find(r => pathname.startsWith(r))
    if (route) {
      const permission = API_PERMISSIONS[route]
      const hasAccess = roles
        ? hasPermission(roles, permission)
        : await checkPermission(permission, userId)
      if (!hasAccess) return json("权限不足", 403)
    }

    return next()
  }

  // Pages: 语言前缀
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  const hasLocalePrefix = i18n.locales.includes(maybeLocale as any)
  if (!hasLocalePrefix) {
    const cookieLocale = request.headers.get('Cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1]
    const acceptLanguage = request.headers.get('Accept-Language')
    const preferredLocale = resolvePreferredLocale(cookieLocale, acceptLanguage)
    const targetLocale = preferredLocale ?? i18n.defaultLocale
    const redirectURL = new URL(`/${targetLocale}${pathname}${url.search}`, request.url)
    return NextResponse.redirect(redirectURL)
  }

  return next()
}

function resolvePreferredLocale(cookieLocale: string | undefined, acceptLanguageHeader: string | null): Locale | null {
  if (cookieLocale && i18n.locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale
  }

  if (!acceptLanguageHeader) return null

  const candidates = parseAcceptLanguage(acceptLanguageHeader)
  for (const lang of candidates) {
    const match = matchLocale(lang)
    if (match) {
      return match
    }
  }

  return null
}

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [lang, ...params] = part.trim().split(';')
      const qualityParam = params.find((param) => param.trim().startsWith('q='))
      const quality = qualityParam ? parseFloat(qualityParam.split('=')[1]) : 1
      return { lang: lang.toLowerCase(), quality: isNaN(quality) ? 1 : quality }
    })
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.lang)
}

function matchLocale(lang: string): Locale | null {
  const exactMatch = i18n.locales.find((locale) => locale.toLowerCase() === lang)
  if (exactMatch) return exactMatch

  const base = lang.split('-')[0]

  // 所有中文变体都回退到实际存在的简体翻译。
  if (base === 'zh') return 'zh-CN'

  const baseMatch = i18n.locales.find((locale) => locale.toLowerCase().split('-')[0] === base)
  if (baseMatch) return baseMatch

  return null
}

export const config = {
  matcher: [
    '/((?!_next|.*\\..*).*)', // all pages excluding static assets
    '/api/emails/:path*',
    '/api/webhook/:path*',
    '/api/roles/:path*',
    '/api/config/:path*',
    '/api/api-keys/:path*',
    '/api/push/:path*',
  ]
} 
