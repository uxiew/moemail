"use client"

import { signOut } from 'next-auth/react'

export async function disconnectPushNotifications(all = false) {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : undefined
  const subscription = await registration?.pushManager?.getSubscription()
  if (!subscription && !all) return
  let serverError: Error | undefined
  try {
    const response = await fetch('/api/push', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(all ? { all: true } : { endpoint: subscription!.endpoint }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error('服务端取消订阅失败，请稍后重试')
  } catch { serverError = new Error('服务端取消订阅失败，请稍后重试') }
  if (subscription) {
    await subscription.unsubscribe()
    const notices = await registration!.getNotifications({ tag: 'moemail-new-mail' })
    notices.forEach(notice => notice.close())
  }
  if (serverError) throw serverError
}

export async function signOutWithPushCleanup(callbackUrl: string) {
  // 推送清理失败不能阻止退出账号；本地 unsubscribe 与服务端解绑分别尝试。
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      disconnectPushNotifications(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Push cleanup timed out')), 10_000) }),
    ])
  } catch { /* 下一次发送遇到 410 时也会清理失效订阅。 */ }
  finally { clearTimeout(timer) }
  await signOut({ callbackUrl })
}
