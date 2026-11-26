import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { getInstallPlatform, INSTALL_DISMISS_MS, isInstallDismissed } from '../app/lib/pwa-install'

test('install guidance distinguishes phones, desktop-mode iPad and desktop browsers', () => {
  const device = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints })
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile')), 'android')
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1')), 'ios')
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (iPad; CPU OS 18_0)')), 'ios')
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)), 'ios')
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (Macintosh)', 'MacIntel', 0)), null)
  assert.equal(getInstallPlatform(device('Mozilla/5.0 (Windows NT 10.0)', 'Win32', 10)), null)
})

test('dismissal lasts seven days and invalid storage cannot hide prompts forever', () => {
  const now = 1800000000000
  assert.equal(isInstallDismissed(String(now), now), true)
  assert.equal(isInstallDismissed(String(now - INSTALL_DISMISS_MS + 1), now), true)
  assert.equal(isInstallDismissed(String(now - INSTALL_DISMISS_MS), now), false)
  for (const value of [null, '', 'garbage', 'Infinity', '-1', '0', String(now + 1)]) {
    assert.equal(isInstallDismissed(value, now), false, String(value))
  }
})

test('manifest keeps existing application identity and real installable icon dimensions', async () => {
  const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'))
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry: { sizes: string }) => entry.sizes === `${size}x${size}`)
    assert.ok(icon)
    const png = await readFile(`public${icon.src}`)
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
  }
})

test('install prompt translations stay complete in both resource bundles', async () => {
  const [zh, en] = await Promise.all(['zh-CN', 'en'].map(async lang =>
    JSON.parse(await readFile(`app/i18n/messages/${lang}/common.json`, 'utf8')).install))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.ok(Object.values(zh).every(value => typeof value === 'string' && value.length > 0))
})
