import { GET, POST as authPost } from "@/lib/auth"
import { NextRequest } from 'next/server'
import { AuthBodyTooLargeError, authFailureResponse, authWriteRule, readAuthBody } from '@/lib/auth-request'

export { GET }

export async function POST(request: NextRequest) {
  if (!authWriteRule(new URL(request.url).pathname, request.method)) return authPost(request)
  try {
    const body = await readAuthBody(request)
    // 显式传 method/headers，不依赖 Pages 请求包装对象的构造器身份来继承 POST。
    return authPost(new NextRequest(request.url, { method: request.method, headers: request.headers, body, signal: request.signal }))
  } catch (error) {
    return authFailureResponse(request, error instanceof AuthBodyTooLargeError ? '请求过大' : '输入格式不正确',
      error instanceof AuthBodyTooLargeError ? 413 : 400, error instanceof AuthBodyTooLargeError ? 'request_too_large' : 'invalid_request')
  }
}

export const runtime = 'edge'
