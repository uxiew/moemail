"use client"

import { signOut } from 'next-auth/react'

export function waitForPushWorker(registration: ServiceWorkerRegistration) {
  // ready 可能返回升级前仍在运行的旧 SW；收到能力确认后才允许订阅。
  return new Promise<void>((resolve, reject) => {
    let channel: MessageChannel | undefined
    const finish = (error?: Error) => {
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', check)
      channel?.port1.close(); channel?.port2.close()
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      channel?.port1.close(); channel?.port2.close()
      channel = new MessageChannel()
      channel.port1.onmessage = event => { if (event.data === true) finish() }
      registration.active?.postMessage('moemail-push-ready', [channel.port2])
    }
    const timer = setTimeout(() => finish(new Error('通知后台正在更新，请稍后重新检查。')), 8000)
    navigator.serviceWorker.addEventListener('controllerchange', check)
    check()
  })
}

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
