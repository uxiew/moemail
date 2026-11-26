import { writeFile } from 'node:fs/promises'
import { base64url } from '../app/lib/web-push'

const output = process.argv[2]
if (!output) throw new Error('Usage: tsx scripts/generate-push-keys.ts <private-output.json>')
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const settings = {
  WEB_PUSH_PUBLIC_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
  WEB_PUSH_PRIVATE_KEY: base64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))),
}
await writeFile(output, JSON.stringify(settings, null, 2), { mode: 0o600, flag: 'wx' })
console.log('Push keys saved to a new private file; existing files are never overwritten.')
