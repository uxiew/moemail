import { getRequestContext } from "@cloudflare/next-on-pages"
import { createTurnstileVerifier, readTurnstileConfig, type TurnstileConfig, type TurnstileContext, type TurnstileVerificationResult } from './turnstile-validation'

export async function getTurnstileConfig(): Promise<TurnstileConfig> {
  return readTurnstileConfig(getRequestContext().env.SITE_CONFIG)
}

const verify = createTurnstileVerifier()

export async function verifyTurnstileToken(token: string | null | undefined, request: Request, action: TurnstileContext['action']): Promise<TurnstileVerificationResult> {
  const config = await getTurnstileConfig()
  return verify(config, token, {
    hostname: new URL(request.url).hostname, action,
    allowTestKeys: getRequestContext().env.TURNSTILE_TEST_MODE === 'true',
  })
}
