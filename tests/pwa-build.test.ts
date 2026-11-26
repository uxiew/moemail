import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('Pages service worker precaches only published static assets, not private responses', async () => {
  const output = resolve(process.env.PWA_BUILD_DIR || '.vercel/output/static')
  const source = await readFile(resolve(output, 'sw.js'), 'utf8')
  let entries: { url: string }[] = []
  const define = (_deps: string[], factory: (workbox: object) => void) => factory({
    clientsClaim() {},
    cleanupOutdatedCaches() {},
    precacheAndRoute(manifest: typeof entries) { entries = manifest },
    // 不提供 registerRoute；意外恢复 API/HTML 的运行时缓存时测试必须失败。
  })
  runInNewContext(source, { self: { define, skipWaiting() {} }, define, importScripts() {} }, { timeout: 1000 })
  assert.ok(entries.length > 0, 'Service worker must contain a precache manifest')
  for (const { url } of entries) {
    const path = decodeURIComponent(url)
    assert.ok(path.startsWith('/_next/static/') || path.startsWith('/icons/') ||
      ['/manifest.json', '/robots.txt', '/llms.txt', '/favicon.ico'].includes(path), `Unexpected cache entry: ${url}`)
    assert.ok((await stat(resolve(output, `.${path}`))).isFile(), `Precached asset must be published: ${url}`)
  }
})
