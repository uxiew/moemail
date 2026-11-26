import { PERMISSIONS, Role, ROLES } from "@/lib/permissions"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { EMAIL_CONFIG } from "@/config"
import { checkPermission } from "@/lib/auth"
import { REGISTRATION_ENABLED_KEY } from "@/lib/registration"
import { hasTurnstileTestKey, isLocalTurnstileTest } from '@/lib/turnstile-validation'

export const runtime = "edge"

export async function GET() {
  const env = getRequestContext().env
  const canManageConfig = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  const [
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    registrationEnabled,
    turnstileEnabled,
    turnstileSiteKey,
    turnstileSecretKey
  ] = await Promise.all([
    env.SITE_CONFIG.get("DEFAULT_ROLE"),
    env.SITE_CONFIG.get("EMAIL_DOMAINS"),
    env.SITE_CONFIG.get("ADMIN_CONTACT"),
    env.SITE_CONFIG.get("MAX_EMAILS"),
    env.SITE_CONFIG.get(REGISTRATION_ENABLED_KEY),
    env.SITE_CONFIG.get("TURNSTILE_ENABLED"),
    env.SITE_CONFIG.get("TURNSTILE_SITE_KEY"),
    env.SITE_CONFIG.get("TURNSTILE_SECRET_KEY")
  ])

  return Response.json({
    defaultRole: defaultRole || ROLES.CIVILIAN,
    emailDomains: emailDomains || "moemail.app",
    adminContact: adminContact || "",
    maxEmails: maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString(),
    registrationEnabled: registrationEnabled === "true",
    turnstile: canManageConfig ? {
      enabled: turnstileEnabled === "true",
      siteKey: turnstileSiteKey || "",
      secretKey: turnstileSecretKey || "",
    } : undefined
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  if (!canAccess) {
    return Response.json({
      error: "权限不足"
    }, { status: 403 })
  }

  const {
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    registrationEnabled,
    turnstile
  } = await request.json() as { 
    defaultRole: Exclude<Role, typeof ROLES.EMPEROR>,
    emailDomains: string,
    adminContact: string,
    maxEmails: string,
    registrationEnabled?: boolean,
    turnstile?: {
      enabled: boolean,
      siteKey: string,
      secretKey: string
    }
  }
  
  if (![ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN].includes(defaultRole)) {
    return Response.json({ error: "无效的角色" }, { status: 400 })
  }

  if (registrationEnabled !== undefined && typeof registrationEnabled !== "boolean") {
    return Response.json({ error: "注册开关必须是布尔值" }, { status: 400 })
  }

  if (turnstile !== undefined) {
    if (!turnstile || typeof turnstile.enabled !== 'boolean' || typeof turnstile.siteKey !== 'string' || typeof turnstile.secretKey !== 'string' ||
        turnstile.siteKey.length > 256 || turnstile.secretKey.length > 256) {
      return Response.json({ error: '无效的 Turnstile 配置' }, { status: 400 })
    }
    turnstile.siteKey = turnstile.siteKey.trim()
    turnstile.secretKey = turnstile.secretKey.trim()
    if (turnstile.enabled && (!turnstile.siteKey || !turnstile.secretKey)) {
      return Response.json({ error: "Turnstile 启用时需要提供 Site Key 和 Secret Key" }, { status: 400 })
    }
    if (turnstile.enabled && hasTurnstileTestKey(turnstile) && !isLocalTurnstileTest(turnstile, {
      hostname: new URL(request.url).hostname, action: 'login', allowTestKeys: getRequestContext().env.TURNSTILE_TEST_MODE === 'true',
    })) return Response.json({ error: '测试密钥只能用于显式开启的本地测试' }, { status: 400 })
  }

  const env = getRequestContext().env
  await Promise.all([
    env.SITE_CONFIG.put("DEFAULT_ROLE", defaultRole),
    env.SITE_CONFIG.put("EMAIL_DOMAINS", emailDomains),
    env.SITE_CONFIG.put("ADMIN_CONTACT", adminContact),
    env.SITE_CONFIG.put("MAX_EMAILS", maxEmails),
    ...(registrationEnabled === undefined ? [] : [
      env.SITE_CONFIG.put(REGISTRATION_ENABLED_KEY, String(registrationEnabled))
    ])
  ])

  // 旧客户端未传 Turnstile 时保留配置；开启前先写密钥，失败不能静默降级成无验证。
  if (turnstile !== undefined) {
    if (!turnstile.enabled) await env.SITE_CONFIG.put('TURNSTILE_ENABLED', 'false')
    await Promise.all([
      env.SITE_CONFIG.put('TURNSTILE_SITE_KEY', turnstile.siteKey),
      env.SITE_CONFIG.put('TURNSTILE_SECRET_KEY', turnstile.secretKey),
    ])
    if (turnstile.enabled) await env.SITE_CONFIG.put('TURNSTILE_ENABLED', 'true')
  }

  return Response.json({ success: true })
} 
