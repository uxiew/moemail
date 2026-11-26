export const INSTALL_DISMISSED_KEY = 'moemail-install-dismissed-at'
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export function getInstallPlatform(device: { userAgent: string; platform: string; maxTouchPoints: number }) {
  if (/iPad|iPhone|iPod/i.test(device.userAgent) ||
      (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(device.userAgent)) return 'android'
  return null
}

export function isInstallDismissed(value: string | null, now = Date.now()) {
  if (!value) return false
  const dismissedAt = Number(value)
  return Number.isFinite(dismissedAt) && dismissedAt > 0 &&
    dismissedAt <= now && now - dismissedAt < INSTALL_DISMISS_MS
}
