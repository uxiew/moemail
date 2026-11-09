(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (predicate, message) => {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(message)
      await wait(25)
    }
  }
  const assert = (value, message) => { if (!value) throw new Error(message) }
  await until(() => window.__quota, 'Fixture did not mount')
  const state = window.__quota
  const count = path => state.calls.filter(call => call === path).length
  const visibility = hidden => {
    state.hidden = hidden
    document.dispatchEvent(new Event('visibilitychange'))
  }
  if (location.search.includes('config-failure')) {
    await until(() => count('/api/config') > 0, 'Configuration was not requested')
    await wait(300)
    assert(count('/api/config') === 1, `Configuration failure retried ${count('/api/config')} times`)
    return { configFailureRequests: count('/api/config'), pass: true }
  }
  await until(() => [...document.querySelectorAll('.font-medium')].some(el => el.textContent === 'quota-one@example.com'), 'Mailbox list did not render')
  state.calls.length = 0
  const addresses = [...document.querySelectorAll('.font-medium')].filter(el => el.textContent === 'quota-one@example.com')
  assert(addresses.length === 1, 'Both responsive layouts mounted')
  addresses[0].click()
  await until(() => count('/api/emails/quota-one') > 0, 'Message list did not fetch')
  await wait(100)
  assert(count('/api/emails/quota-one') === 1, 'Multiple lists fetched the same mailbox')
  const result = { width: innerWidth, mailboxSelectionRequests: count('/api/emails/quota-one') }
  document.getElementById('none').click()
  await wait(50)
  state.calls.length = 0
  visibility(true)
  document.getElementById('messages').click()
  await wait(100)
  assert(count('/api/emails/quota-one') === 0, 'Hidden mount fetched messages')
  visibility(false)
  await until(() => count('/api/emails/quota-one') === 1, 'Visibility did not resume polling')
  state.status = 403
  visibility(true)
  visibility(false)
  await until(() => count('/api/emails/quota-one') === 2, 'Terminal status was not fetched')
  await wait(50)
  visibility(true)
  visibility(false)
  await wait(100)
  assert(count('/api/emails/quota-one') === 2, 'Tab switch revived forbidden polling')
  state.status = 200
  document.getElementById('switch-mailbox').click()
  await until(() => document.body.innerText.includes('/api/emails/quota-two'), 'Mailbox switch failed')
  assert(!document.body.innerText.includes('/api/emails/quota-one'), 'Previous mailbox data remained')
  document.getElementById('none').click()
  await wait(50)
  state.calls.length = 0
  document.getElementById('shared').click()
  await wait(100)
  assert(count('/api/shared/quota-token/messages') === 0, 'Shared initial data fetched twice')
  visibility(true)
  visibility(false)
  await until(() => count('/api/shared/quota-token/messages') === 1, 'Shared polling did not resume')
  state.status = 410
  visibility(true)
  visibility(false)
  await until(() => count('/api/shared/quota-token/messages') === 2, 'Share expiry was not fetched')
  await wait(50)
  visibility(true)
  visibility(false)
  await wait(100)
  assert(count('/api/shared/quota-token/messages') === 2, 'Tab switch revived expired share polling')
  document.getElementById('none').click()
  return { ...result, hiddenMount: true, terminalStop: true, mailboxSwitch: true, sharedStop: true, pass: true }
})()
