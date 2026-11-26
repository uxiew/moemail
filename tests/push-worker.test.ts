import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('background push shows a fixed generic notification even with no window and ignores private payloads', async () => {
  const handlers: Record<string, (event: any) => void> = {}
  const notifications: { title: string; options: object }[] = []
  runInNewContext(await readFile('public/push-worker.js', 'utf8'), { URL, self: {
    addEventListener(type: string, handler: (event: any) => void) { handlers[type] = handler },
    registration: { async showNotification(title: string, options: object) { notifications.push({ title, options }) } },
  } })
  const pending: Promise<unknown>[] = []
  handlers.push({ get data() { throw new Error('Must not read payload') }, waitUntil(p: Promise<unknown>) { pending.push(p) } })
  await Promise.all(pending)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].title, 'MoeMail')
  assert.match(JSON.stringify(notifications[0].options), /你有新邮件/)
  assert.doesNotMatch(JSON.stringify(notifications), /example.com|private|emailId/)
})

test('notification click opens only the same-origin inbox and reuses existing windows', async () => {
  for (const hasWindow of [false, true]) {
    const handlers: Record<string, (event: any) => void> = {}
    const opened: string[] = []
    let focused = false, closed = false
    runInNewContext(await readFile('public/push-worker.js', 'utf8'), { URL, self: {
      location: { origin: 'https://example.com' },
      addEventListener(type: string, fn: (event: any) => void) { handlers[type] = fn },
      clients: {
        async matchAll() { return hasWindow ? [{ url: 'https://example.com/zh-CN', async navigate(url: string) { opened.push(url); return { focus() { focused = true } } } }] : [] },
        async openWindow(url: string) { opened.push(url) },
      },
    } })
    const pending: Promise<unknown>[] = []
    handlers.notificationclick({ notification: { data: { url: 'https://evil.example' }, close() { closed = true } }, waitUntil(p: Promise<unknown>) { pending.push(p) } })
    await Promise.all(pending)
    assert.deepEqual(opened, ['https://example.com/zh-CN/moe'])
    assert.equal(focused, hasWindow)
    assert.equal(closed, true)
  }
})
