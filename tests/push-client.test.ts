import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForPushWorker } from '../app/lib/push-client'

const capable = { postMessage(message: string, ports: MessagePort[]) {
  assert.equal(message, 'moemail-push-ready')
  ports[0].postMessage(true)
} } as ServiceWorker

test('push subscription waits for an active worker with notification support', async t => {
  const serviceWorker = new EventTarget()
  t.mock.getter(globalThis, 'navigator', () => ({ serviceWorker }))
  await waitForPushWorker({ active: capable } as ServiceWorkerRegistration)
})

test('an old active worker is not treated as push-ready; controller upgrade unblocks it', async t => {
  const serviceWorker = new EventTarget()
  t.mock.getter(globalThis, 'navigator', () => ({ serviceWorker }))
  const registration = { active: { postMessage() {} } as unknown as ServiceWorker }
  let resolved = false
  const pending = waitForPushWorker(registration as ServiceWorkerRegistration).then(() => { resolved = true })
  await Promise.resolve()
  assert.equal(resolved, false)
  registration.active = capable
  serviceWorker.dispatchEvent(new Event('controllerchange'))
  await pending
  assert.equal(resolved, true)
})

test('an unsupported worker times out without leaving a controller listener', async t => {
  const serviceWorker = new EventTarget()
  t.mock.getter(globalThis, 'navigator', () => ({ serviceWorker }))
  const remove = t.mock.method(serviceWorker, 'removeEventListener')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = waitForPushWorker({ active: { postMessage() {} } } as unknown as ServiceWorkerRegistration)
  const assertion = assert.rejects(pending, /后台正在更新/)
  t.mock.timers.tick(8000)
  await assertion
  assert.equal(remove.mock.callCount(), 1)
})
