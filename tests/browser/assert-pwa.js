// 仅在本地、Android UA 的实际页面中执行；安装事件是合成事件，不代替真机安装。
(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message) }
  assert(['localhost', '127.0.0.1'].includes(location.hostname), 'Local preview only')
  assert(/Android/.test(navigator.userAgent), 'Use an Android user agent')
  const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
  const key = 'moemail-install-dismissed-at'
  const banner = () => document.querySelector('[data-install-prompt]')
  const action = () => banner()?.querySelector('button:not([aria-label])')
  const resetDismissal = () => {
    localStorage.removeItem(key)
    dispatchEvent(new StorageEvent('storage', { key, newValue: null }))
  }
  const offer = prompt => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    let choose, fallback
    const userChoice = new Promise(resolve => { choose = resolve })
    Object.assign(event, { prompt, userChoice })
    const original = window.setTimeout
    // 只推进备用入口的 30 秒计时器；页面其他逻辑仍使用真实时钟。
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 30000) fallback = callback
      return original.call(window, delay === 30000 ? () => {} : callback, delay, ...args)
    }
    try { dispatchEvent(event) } finally { window.setTimeout = original }
    return { event, choose, advance: () => { assert(fallback, 'Expected a 30s fallback delay'); fallback() } }
  }
  resetDismissal()
  await pause(3200)

  let calls = 0
  const native = offer(async () => { calls++ })
  await pause()
  assert(!native.event.defaultPrevented && !banner(), 'Browser-native UI must be allowed before the fallback')
  native.advance()
  await pause()
  assert(banner(), 'Mobile fallback must appear after its delay')
  action().click()
  action().click()
  await pause()
  assert(calls === 1, 'A deferred prompt must be consumed only once')
  assert(action()?.disabled, 'Install action must be disabled while awaiting the browser')
  native.choose({ outcome: 'dismissed' })
  await pause()
  assert(!banner() && Number(localStorage.getItem(key)) > 0, 'Dismissal must persist')

  offer(async () => {}).advance()
  await pause()
  assert(!banner(), 'Fresh install events must respect the seven-day cooldown')
  resetDismissal()
  offer(async () => { throw new Error('Synthetic install failure') }).advance()
  await pause()
  action().click()
  await pause()
  assert(banner()?.querySelector('[role=status]'), 'Installation failure must offer a browser-menu fallback')

  const accepted = offer(async () => {})
  accepted.advance()
  await pause()
  action().click()
  accepted.choose({ outcome: 'accepted' })
  await pause()
  assert(!banner(), 'Accepted installation must hide the prompt')
  resetDismissal()
  dispatchEvent(new Event('appinstalled'))
  const afterInstall = offer(async () => {})
  await pause()
  assert(!banner() && !afterInstall.event.defaultPrevented, 'Installed applications must not be promoted again')
  assert(document.documentElement.scrollWidth <= innerWidth, 'Prompt must not cause horizontal overflow')
  return { pass: true, syntheticInstallEvents: true, promptCalls: calls }
})()
