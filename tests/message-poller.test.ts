import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { createMessagePoller } from '../app/lib/message-poller'

class Visibility extends EventTarget {
  hidden = false
  change(hidden: boolean) {
    this.hidden = hidden
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

function setup(t: TestContext, options: { hidden?: boolean; immediate?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const visibility = new Visibility()
  visibility.hidden = options.hidden ?? false
  const requests: { url: URL; signal: AbortSignal }[] = []
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    requests.push({ url, signal: init.signal as AbortSignal })
    return Response.json({ messages: [] })
  })
  const responses: (string | undefined)[] = []
  let settled = 0
  const poller = createMessagePoller({
    url: 'https://example.com/api/emails/mailbox?type=sent',
    interval: 30_000, visibility, immediate: options.immediate,
    onResponse: async (_response, cursor) => { responses.push(cursor) },
    onSettled: () => { settled++ },
  })
  t.after(() => poller.dispose())
  return { visibility, requests, fetchMock, responses, poller, settled: () => settled }
}

test('initially hidden tabs never start a timer or fetch; visibility resumes once', async (t) => {
  const s = setup(t, { hidden: true })
  t.mock.timers.tick(90_000)
  assert.equal(s.requests.length, 0)
  s.visibility.change(false)
  await setImmediate()
  assert.equal(s.requests.length, 1)
  s.visibility.change(true)
  t.mock.timers.tick(90_000)
  assert.equal(s.requests.length, 1)
})

test('polling is serial, including manual refresh and visibility events', async (t) => {
  const s = setup(t, { immediate: false })
  let resolve!: (response: Response) => void
  s.fetchMock.mock.mockImplementation(() => new Promise<Response>(r => { resolve = r }))
  t.mock.timers.tick(30_000)
  await setImmediate()
  const manual = s.poller.refresh()
  s.visibility.change(true)
  s.visibility.change(false)
  t.mock.timers.tick(90_000)
  assert.equal(s.fetchMock.mock.callCount(), 1)
  resolve(Response.json({ messages: [] }))
  await manual
  assert.equal(s.settled(), 1)
  t.mock.timers.tick(29_999)
  assert.equal(s.fetchMock.mock.callCount(), 1)
  t.mock.timers.tick(1)
  await setImmediate()
  assert.equal(s.fetchMock.mock.callCount(), 2)
})

for (const status of [401, 403, 404, 410]) {
  test(`${status} stops automatic polling even after tab switches`, async (t) => {
    const s = setup(t, { immediate: false })
    s.fetchMock.mock.mockImplementation(async () => new Response(null, { status }))
    t.mock.timers.tick(30_000)
    await setImmediate()
    s.visibility.change(true)
    s.visibility.change(false)
    t.mock.timers.tick(600_000)
    assert.equal(s.fetchMock.mock.callCount(), 1)
  })
}

test('transient errors back off and a successful response resets the interval', async (t) => {
  const s = setup(t, { immediate: false })
  s.fetchMock.mock.mockImplementationOnce(async () => new Response(null, { status: 429 }))
  t.mock.timers.tick(30_000)
  await setImmediate()
  t.mock.timers.tick(59_999)
  assert.equal(s.fetchMock.mock.callCount(), 1)
  t.mock.timers.tick(1)
  await setImmediate()
  assert.equal(s.fetchMock.mock.callCount(), 2)
  t.mock.timers.tick(30_000)
  await setImmediate()
  assert.equal(s.fetchMock.mock.callCount(), 3)
})

test('cursor requests preserve existing parameters and do not change later polls', async (t) => {
  const s = setup(t, { immediate: false })
  await s.poller.refresh('cursor+value/=')
  assert.equal(s.requests[0].url.searchParams.get('type'), 'sent')
  assert.equal(s.requests[0].url.searchParams.get('cursor'), 'cursor+value/=')
  assert.deepEqual(s.responses, ['cursor+value/='])
  t.mock.timers.tick(30_000)
  await setImmediate()
  assert.equal(s.requests[1].url.searchParams.has('cursor'), false)
})

test('disposing aborts pending work and ignores stale mailbox responses', async (t) => {
  const s = setup(t, { immediate: false })
  let resolve!: (response: Response) => void
  let signal!: AbortSignal
  s.fetchMock.mock.mockImplementation((_url: URL, init: RequestInit) => {
    signal = init!.signal as AbortSignal
    return new Promise<Response>(r => { resolve = r })
  })
  const pending = s.poller.refresh()
  await setImmediate()
  s.poller.dispose()
  assert.equal(signal.aborted, true)
  resolve(Response.json({ messages: [] }))
  await pending
  s.visibility.change(false)
  t.mock.timers.tick(90_000)
  assert.equal(s.fetchMock.mock.callCount(), 1)
  assert.equal(s.responses.length, 0)
  assert.equal(s.settled(), 0)
})

test('disposing before a queued refresh starts sends no request', async (t) => {
  const s = setup(t, { immediate: false })
  const pending = s.poller.refresh()
  s.poller.dispose()
  await pending
  assert.equal(s.fetchMock.mock.callCount(), 0)
})

test('network failures settle the UI and retry rather than overlapping requests', async (t) => {
  const s = setup(t, { immediate: false })
  t.mock.method(console, 'error', () => {})
  s.fetchMock.mock.mockImplementationOnce(() => { throw new Error('offline') })
  await s.poller.refresh()
  assert.equal(s.settled(), 1)
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(s.fetchMock.mock.callCount(), 2)
  assert.equal(s.responses.length, 1)
})
