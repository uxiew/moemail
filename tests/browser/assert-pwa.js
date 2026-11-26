// 仅在本地、Android UA 的实际页面中执行；安装事件是合成事件，不代替真机安装。
(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message) }
  assert(['localhost', '127.0.0.1'].includes(location.hostname), 'Local preview only')
  assert(/Android/.test(navigator.userAgent), 'Use an Android user agent')
  const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
  const key = 'moemail-install-dismissed-at'
  const banner = () => document.querySelector('[data-install-prompt]')
  const action = () => banner()?.querySelector('[data-install-action]')
  const resetDismissal = () => {
    localStorage.removeItem(key)
    dispatchEvent(new StorageEvent('storage', { key, newValue: null }))
  }
  const offer = prompt => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    let choose
    const userChoice = new Promise(resolve => { choose = resolve })
    Object.assign(event, { prompt, userChoice })
    dispatchEvent(event)
    return { event, choose }
  }
  resetDismissal()
  await pause(5200)
  assert(banner(), 'Android must proactively offer installation without waiting for a native event')

  let calls = 0
  const native = offer(async () => { calls++ })
  await pause()
  assert(!native.event.defaultPrevented && banner(), 'Native events must remain uncancelled and make direct installation available')
  action().click()
  action().click()
  await pause()
  assert(calls === 1, 'A deferred prompt must be consumed only once')
  assert(action()?.disabled, 'Install action must be disabled while awaiting the browser')
  native.choose({ outcome: 'dismissed' })
  await pause()
  assert(!banner() && Number(localStorage.getItem(key)) > 0, 'Dismissal must persist')

  offer(async () => {})
  await pause()
  assert(!banner(), 'Fresh install events must respect the seven-day cooldown')
  resetDismissal()
  offer(async () => { throw new Error('Synthetic install failure') })
  await pause()
  action().click()
  await pause()
  assert(banner()?.querySelector('[role=status]'), 'Installation failure must offer a browser-menu fallback')

  const accepted = offer(async () => {})
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
