import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { locales, defaultLocale, LOCALE_LABELS } from '../app/i18n/config'

test('enabled locales match the Chinese-only UI and have all message bundles', async () => {
  assert.deepEqual(locales, ['zh-CN'])
  assert.equal(defaultLocale, 'zh-CN')
  for (const locale of locales) {
    assert.ok(LOCALE_LABELS[locale])
    for (const bundle of ['common', 'home', 'auth', 'metadata', 'emails', 'profile']) {
      const messages = JSON.parse(await readFile(new URL(`../app/i18n/messages/${locale}/${bundle}.json`, import.meta.url), 'utf8'))
      assert.ok(Object.keys(messages).length > 0)
    }
  }
})
