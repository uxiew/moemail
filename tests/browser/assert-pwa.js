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
  const offer = (prompt, choice) => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt, userChoice: choice })
    dispatchEvent(event)
    return event
  }
  resetDismissal()
  await pause(3200)

  let calls = 0
  let choose
  const choice = new Promise(resolve => { choose = resolve })
  const event = offer(async () => { calls++ }, choice)
  await pause()
  assert(event.defaultPrevented && banner(), 'Installable Android must show the custom prompt')
  action().click()
  action().click()
  await pause()
  assert(calls === 1, 'A deferred prompt must be consumed only once')
  assert(action()?.disabled, 'Install action must be disabled while awaiting the browser')
  choose({ outcome: 'dismissed' })
  await pause()
  assert(!banner() && Number(localStorage.getItem(key)) > 0, 'Dismissal must persist')

  offer(async () => {}, Promise.resolve({ outcome: 'accepted' }))
  await pause()
  assert(!banner(), 'Fresh install events must respect the seven-day cooldown')
  resetDismissal()
  offer(async () => { throw new Error('Synthetic install failure') }, Promise.resolve({ outcome: 'dismissed' }))
  await pause()
  action().click()
  await pause()
  assert(banner()?.querySelector('[role=status]'), 'Installation failure must offer a browser-menu fallback')

  offer(async () => {}, Promise.resolve({ outcome: 'accepted' }))
  await pause()
  action().click()
  await pause()
  assert(!banner(), 'Accepted installation must hide the prompt')
  resetDismissal()
  dispatchEvent(new Event('appinstalled'))
  const afterInstall = offer(async () => {}, Promise.resolve({ outcome: 'accepted' }))
  await pause()
  assert(!banner() && !afterInstall.defaultPrevented, 'Installed applications must not be promoted again')
  assert(document.documentElement.scrollWidth <= innerWidth, 'Prompt must not cause horizontal overflow')
  return { pass: true, syntheticInstallEvents: true, promptCalls: calls }
})()
