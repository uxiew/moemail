"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getInstallPlatform } from '@/lib/pwa-install'
import { disconnectPushNotifications, waitForPushWorker } from '@/lib/push-client'

type PushConfig = { publicKey: string | null; subscriptions: string[]; maxDevices: number }

export function PushNotificationPanel() {
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const subscription = useRef<PushSubscription | null>(null)
  const [config, setConfig] = useState<PushConfig | null>(null)
  const [state, setState] = useState<'loading' | 'off' | 'on' | 'stale' | 'unavailable'>('loading')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (getInstallPlatform(navigator) === 'ios' && !matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone) {
      setState('unavailable'); setMessage('iPhone / iPad 请先添加到主屏幕，再从应用图标打开并开启通知。'); return
    }
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unavailable'); setMessage('当前浏览器不支持系统推送，请使用支持 Web Push 的浏览器。'); return
    }
    try {
      const response = await fetch('/api/push', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const data = await response.json() as PushConfig & { error?: string }
      if (!response.ok) throw new Error(data.error || '通知配置读取失败')
      setConfig(data)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        registration.current = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('浏览器后台尚未就绪，请稍后重新检查。')), 8000) }),
        ])
      } finally { clearTimeout(timer) }
      await waitForPushWorker(registration.current)
      subscription.current = await registration.current?.pushManager.getSubscription() ?? null
      if (subscription.current) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.current.endpoint))
        const id = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
        setState(data.subscriptions.includes(id) ? 'on' : 'stale')
      } else setState('off')
      setMessage(!data.publicKey ? '管理员尚未配置推送服务。' : Notification.permission === 'denied'
        ? '通知权限已被拒绝，请在浏览器或系统设置中允许后重试。' : '')
    } catch (error) {
      setState('unavailable'); setMessage(error instanceof Error ? error.message : '通知暂时不可用')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function enable() {
    if (busyRef.current || !config?.publicKey || !registration.current?.active) return
    busyRef.current = true; setBusy(true); setMessage('')
    let created: PushSubscription | undefined
    try {
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      // 必须在点击调用栈内 subscribe，让 iOS 直接显示系统授权，而不是等待异步请求后再申请。
      created = await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      const response = await fetch('/api/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: created.endpoint }), signal: AbortSignal.timeout(8000),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || '保存订阅失败')
      await refresh()
    } catch (error) {
      if (created) await created.unsubscribe().catch(() => {})
      setMessage(Notification.permission === 'denied' ? '未获得系统通知权限，可在浏览器设置中重新允许。'
        : error instanceof Error ? error.message : '开启通知失败')
    } finally { busyRef.current = false; setBusy(false) }
  }

  async function disable(all = false) {
    if (busyRef.current) return
    if (all && !window.confirm('关闭此账号所有设备的新邮件通知？其他设备需要手动重新开启。')) return
    busyRef.current = true; setBusy(true); setMessage('')
    try { await disconnectPushNotifications(all); await refresh() }
    catch (error) { await refresh(); setMessage(error instanceof Error ? error.message : '关闭通知失败') }
    finally { busyRef.current = false; setBusy(false) }
  }

  const canEnable = state === 'off' && !!config?.publicKey && !!registration.current?.active && typeof Notification !== 'undefined' && Notification.permission !== 'denied'
  return (
    <section className="space-y-4 rounded-lg border-2 border-primary/20 bg-background p-6" aria-labelledby="push-notification-title">
      <h2 id="push-notification-title" className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-5 w-5 text-primary" />新邮件系统通知</h2>
      <p className="text-sm text-muted-foreground">关闭网页后也可提醒。仅显示「你有新邮件」，不发送邮件地址、主题或正文；点击通知后打开邮箱。</p>
      <p className="text-sm">{state === 'on' ? '此设备已开启通知' : state === 'stale' ? '此浏览器有旧订阅，请先清理再为当前账号开启。' : state === 'loading' ? '正在检查通知状态…' : '此设备尚未开启通知'}</p>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !canEnable} onClick={() => void enable()}>开启此设备通知</Button>
        {(state === 'on' || state === 'stale') && <Button type="button" variant="outline" disabled={busy} onClick={() => void disable()}>{state === 'stale' ? '清理旧订阅' : '关闭此设备通知'}</Button>}
        {!!config?.subscriptions.length && <Button type="button" variant="outline" disabled={busy} onClick={() => void disable(true)}>关闭所有设备通知</Button>}
        <Button type="button" variant="ghost" disabled={busy || state === 'loading'} onClick={() => void refresh()}>重新检查</Button>
      </div>
      {config?.publicKey && <p className="text-xs text-muted-foreground">每个账号最多 {config.maxDevices} 个设备。通知经浏览器或系统推送服务投递，时效受网络、省电和系统设置影响。</p>}
    </section>
  )
}
