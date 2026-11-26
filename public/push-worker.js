self.addEventListener('message', event => {
  if (event.data === 'moemail-push-ready') event.ports[0]?.postMessage(true)
})

self.addEventListener('push', event => {
  // 通知文案固定在客户端；即使服务端发来载荷，也不展示邮件或用户信息。
  event.waitUntil(self.registration.showNotification('MoeMail', {
    body: '你有新邮件，点击打开邮箱。',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: 'moemail-new-mail',
    renotify: true,
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL('/zh-CN/moe', self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      const navigated = await existing.navigate(target)
      if (navigated) return navigated.focus()
    }
    return self.clients.openWindow(target)
  })())
})
