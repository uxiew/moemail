import { NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'
import { createDb } from '@/lib/db'
import { authSchema } from '@/lib/validation'
import { isRegistrationEnabled, registerUser, UsernameTakenError } from '@/lib/registration'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { AuthBodyTooLargeError, readAuthBody } from '@/lib/auth-request'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    if (!await isRegistrationEnabled(getRequestContext().env.SITE_CONFIG)) {
      return NextResponse.json({ error: '注册已关闭，请联系管理员' }, { status: 403 })
    }
    let input: unknown
    try { input = JSON.parse(new TextDecoder().decode(await readAuthBody(request))) }
    catch (error) {
      return NextResponse.json({ error: error instanceof AuthBodyTooLargeError ? '请求过大' : '输入格式不正确' }, { status: error instanceof AuthBodyTooLargeError ? 413 : 400 })
    }
    const parsed = authSchema.safeParse(input)
    if (!parsed.success) {
      return NextResponse.json({ error: '输入格式不正确' }, { status: 400 })
    }
    const { username, password, turnstileToken } = parsed.data
    const verification = await verifyTurnstileToken(turnstileToken, request, 'register')
    if (!verification.success) {
      return NextResponse.json({ error: verification.reason === 'missing-token' ? '请先完成安全验证' : '安全验证未通过' }, { status: 400 })
    }
    const user = await registerUser(createDb(), username, password)
    return NextResponse.json({ user })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UsernameTakenError ? error.message : '注册失败，请稍后重试' },
      { status: error instanceof UsernameTakenError ? 409 : 500 },
    )
  }
}
