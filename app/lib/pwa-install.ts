export const INSTALL_DISMISSED_KEY = 'moemail-install-dismissed-at'
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export function getInstallPlatform(device: { userAgent: string; platform: string; maxTouchPoints: number }) {
  if (/iPad|iPhone|iPod/i.test(device.userAgent) ||
      (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(device.userAgent)) return 'android'
  return null
}

export type InstallMode = 'ios' | 'android' | 'embedded' | 'native'

export function getInstallMode(device: { userAgent: string; platform: string; maxTouchPoints: number }, nativeAvailable: boolean): InstallMode | null {
  const platform = getInstallPlatform(device)
  if (!platform) return null
  if (platform === 'android' && nativeAvailable) return 'native'
  if (/MicroMessenger|\bQQ\/|Weibo|DingTalk|; wv\)/i.test(device.userAgent)) return 'embedded'
  return platform
}

export function isInstallDismissed(value: string | null, now = Date.now()) {
  if (!value) return false
  const dismissedAt = Number(value)
  return Number.isFinite(dismissedAt) && dismissedAt > 0 &&
    dismissedAt <= now && now - dismissedAt < INSTALL_DISMISS_MS
}
