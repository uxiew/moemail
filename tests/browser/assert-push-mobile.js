// 在本地已登录的个人中心执行；仅模拟 API 暴露范围，不申请权限或创建订阅。
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Local preview only')
  const panel = () => document.querySelector('[aria-labelledby=push-notification-title]')
  if (!panel()) throw new Error('Open the local profile page first')
  const userAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
  const push = Object.getOwnPropertyDescriptor(window, 'PushManager')
  const notification = Object.getOwnPropertyDescriptor(window, 'Notification')
  const refresh = async () => {
    panel().querySelector('button:last-of-type').click()
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  try {
    delete window.PushManager
    delete window.Notification
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    await refresh()
    if (!panel().innerText.includes('先添加到主屏幕')) throw new Error('iOS must receive installation guidance even without exposed Push APIs')
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Example Desktop Browser' })
    await refresh()
    if (!panel().innerText.includes('当前浏览器不支持')) throw new Error('Unsupported desktop must not be mistaken for iOS')
    return { pass: true, iOSWithoutPushApiGuided: true, unsupportedDesktopHandled: true }
  } finally {
    if (userAgent) Object.defineProperty(navigator, 'userAgent', userAgent)
    else delete navigator.userAgent
    if (push) Object.defineProperty(window, 'PushManager', push)
    if (notification) Object.defineProperty(window, 'Notification', notification)
    await refresh()
  }
})()
