import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { hashPassword } from '../app/lib/utils'

const statePath = process.env.MOEMAIL_LOCAL_STATE_DIR
if (!statePath || !process.env.AUTH_SECRET) {
  throw new Error('Set MOEMAIL_LOCAL_STATE_DIR and AUTH_SECRET for an isolated local preview')
}
const config = JSON.parse(await readFile('wrangler.json', 'utf8'))
if ([...(config.d1_databases ?? []), ...(config.kv_namespaces ?? [])].some((binding: { remote?: boolean }) => binding.remote)) {
  throw new Error('Local preview does not allow remote bindings')
}
const platform = await getPlatformProxy<Env>({
  configPath: resolve('wrangler.json'),
  persist: { path: resolve(statePath) },
  envFiles: [],
  remoteBindings: false,
})

try {
  const db = platform.env.DB
  const initialized = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").first()
  if (initialized) throw new Error('Preview database already exists; use a new empty state directory')
  for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`drizzle/${file}`, 'utf8')
    for (const statement of sql.split('--> statement-breakpoint').filter(value => value.trim())) {
      await db.prepare(statement).run()
    }
  }

  const now = Date.now()
  const password = 'LocalPreviewOnly123!'
  const hash = await hashPassword(password)
  for (const role of ['emperor', 'duke', 'knight', 'civilian']) {
    await db.batch([
      db.prepare('INSERT INTO role (id, name) VALUES (?, ?)').bind(`preview-role-${role}`, role),
      db.prepare('INSERT INTO user (id, username, name, email, password, image) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`preview-${role}`, `preview_${role}`, '本地测试用户', `${role}@example.com`, hash, '/icons/icon-192x192.png'),
      db.prepare('INSERT INTO user_role (user_id, role_id) VALUES (?, ?)').bind(`preview-${role}`, `preview-role-${role}`),
      db.prepare('INSERT INTO api_keys (id, user_id, name, key, enabled, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`preview-key-${role}`, `preview-${role}`, 'Local preview key', `preview-only-${role}-key`, 1, Math.floor(now / 1000) + 86400),
    ])
  }

  const addresses = [
    'preview-inbox@example.com',
    'long-mailbox-address-for-responsive-layout-and-copy-button-check@example.com',
    'empty-inbox@example.com',
  ]
  for (const [index, address] of addresses.entries()) {
    await db.prepare('INSERT INTO email (id, address, userId, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(`preview-mailbox-${index}`, address, 'preview-duke', now - index * 1000, now + 86400_000).run()
  }
  for (let index = 0; index < 25; index++) {
    await db.prepare('INSERT INTO message (id, emailId, from_address, to_address, subject, content, html, type, received_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`preview-message-${index}`, 'preview-mailbox-0', 'sender@example.com', addresses[0],
        index === 0 ? '本地预览：桌面三栏与手机布局检查' : `回归测试邮件 ${index}`,
        index === 24 ? '这是一封短邮件，无需滚动。' : '这是本地假数据。请检查标题、工具栏和正文的对齐。\n' + 'long-content-'.repeat(50),
        index === 24 ? '<p>这是一封短邮件，无需滚动。</p>' : `<h2>布局回归测试</h2><p>这封邮件仅用于本地预览，不会发送到外部。</p><p>${'long-html-content-'.repeat(40)}</p>`,
        'received', now - index * 60_000, now - index * 60_000).run()
  }
  await db.prepare('INSERT INTO message (id, emailId, from_address, to_address, subject, content, html, type, received_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('preview-long-message', 'preview-mailbox-1', 'long-sender-address-for-responsive-layout@example.com', addresses[1],
      'LongSubject'.repeat(20), 'long-text-without-spaces'.repeat(50), '', 'received', now, now).run()
  await db.prepare('INSERT INTO email_share (id, email_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind('preview-share', 'preview-mailbox-0', 'preview-share-token', now, now + 86400_000).run()
  await platform.env.SITE_CONFIG.put('EMAIL_DOMAINS', 'example.com')
  // 只开启界面能力，不配置发送凭据；测试不执行真实发信。
  await platform.env.SITE_CONFIG.put('EMAIL_SERVICE_ENABLED', 'true')
  console.log(JSON.stringify({ username: 'preview_duke', password, mailboxId: 'preview-mailbox-0', shareToken: 'preview-share-token' }))
} finally {
  await platform.dispose()
}
