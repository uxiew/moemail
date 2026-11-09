import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import cleanup from '../workers/cleanup'
import receiver from '../workers/email-receiver'

let directory: string
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>
let db: D1Database

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'moemail-worker-test-'))
  const configPath = join(directory, 'wrangler.json')
  await writeFile(configPath, JSON.stringify({
    name: 'quota-tests', compatibility_date: '2024-03-20',
    d1_databases: [{ binding: 'DB', database_name: 'quota-tests', database_id: '00000000-0000-0000-0000-000000000001' }],
  }))
  platform = await getPlatformProxy<Env>({ configPath, persist: false })
  db = platform.env.DB
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()
  for (const file of migrations) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint').filter(sql => sql.trim())) {
      await db.prepare(statement).run()
    }
  }
})

after(async () => {
  await platform?.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.prepare('DELETE FROM email').run()
})

async function mailbox(id: string, expiresAt: number) {
  await db.prepare('INSERT INTO email (id, address, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, `${id}@example.com`, Date.now(), expiresAt).run()
}

function incoming(to: string) {
  let reads = 0
  const rejected: string[] = []
  const message = {
    from: 'sender@example.com', to, headers: new Headers(), rawSize: 100,
    get raw() {
      reads++
      return new Blob(['From: sender@example.com\r\nSubject: private subject\r\n\r\nprivate body']).stream()
    },
    setReject(reason: string) { rejected.push(reason) },
    async forward() { return { messageId: 'forwarded' } }, async reply() { return { messageId: 'replied' } },
  }
  return { message: message as ForwardableEmailMessage, rejected, reads: () => reads }
}

test('cleanup deletes at most 100 expired mailboxes, cascades, and can run again', async () => {
  const now = Date.now()
  await mailbox('active', now + 60_000)
  await mailbox('permanent', new Date('9999-01-01').getTime())
  await db.batch(Array.from({ length: 101 }, (_, i) => db.prepare(
    'INSERT INTO email (id, address, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(`expired-${i}`, `expired-${i}@example.com`, now, now - 1000)))
  await db.prepare("INSERT INTO message (id, emailId, subject, content, received_at, sent_at) VALUES ('message', 'expired-0', '', '', ?, ?)").bind(now, now).run()
  await db.prepare("INSERT INTO email_share (id, email_id, token, created_at) VALUES ('share', 'expired-0', 'share-token', ?)").bind(now).run()
  await db.prepare("INSERT INTO message_share (id, message_id, token, created_at) VALUES ('message-share', 'message', 'message-token', ?)").bind(now).run()
  await cleanup.scheduled({} as ScheduledEvent, { DB: db })
  assert.equal(await db.prepare('SELECT count(*) AS n FROM email WHERE expires_at < ?').bind(now).first('n'), 1)
  await cleanup.scheduled({} as ScheduledEvent, { DB: db })
  await cleanup.scheduled({} as ScheduledEvent, { DB: db })
  assert.equal(await db.prepare('SELECT count(*) AS n FROM email').first('n'), 2)
  for (const table of ['message', 'email_share', 'message_share']) {
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0)
  }
})

test('expired and unknown recipients are rejected before MIME parsing or writes', async () => {
  await mailbox('expired', Date.now() - 1000)
  for (const to of ['expired@example.com', 'unknown@example.com']) {
    const input = incoming(to)
    await receiver.email(input.message, platform.env)
    assert.equal(input.reads(), 0)
    assert.equal(input.rejected.length, 1)
  }
  assert.equal(await db.prepare('SELECT count(*) AS n FROM message').first('n'), 0)
})

test('active recipient matching is case-insensitive and does not log mail content', async (t) => {
  await mailbox('active', Date.now() + 60_000)
  const log = t.mock.method(console, 'log', () => {})
  const input = incoming('ACTIVE@EXAMPLE.COM')
  await receiver.email(input.message, platform.env)
  assert.equal(input.rejected.length, 0)
  assert.equal(input.reads(), 1)
  const saved = await db.prepare('SELECT emailId, subject, content FROM message').first()
  assert.deepEqual(saved, { emailId: 'active', subject: 'private subject', content: 'private body\n' })
  const logged = JSON.stringify(log.mock.calls.map(call => call.arguments))
  assert.doesNotMatch(logged, /private subject|private body|sender@example.com/)
})
