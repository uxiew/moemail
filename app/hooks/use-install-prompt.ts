"use client"

import { useEffect, useRef, useState } from 'react'
import { getInstallMode, getInstallPlatform, INSTALL_DISMISSED_KEY, isInstallDismissed, type InstallMode } from '@/lib/pwa-install'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const promptRef = useRef<InstallPromptEvent | null>(null)
  const busyRef = useRef(false)
  const [mode, setMode] = useState<InstallMode | null>(null)
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())) } catch { /* 隐私模式下只隐藏本次页面提示。 */ }
  }

  useEffect(() => {
    if (!window.isSecureContext) return
    const platform = getInstallPlatform(navigator)
    const standalone = matchMedia('(display-mode: standalone)')
    const viewport = matchMedia('(max-width: 1023px)')
    let installed = false
    let active = true
    try { setDismissed(isInstallDismissed(localStorage.getItem(INSTALL_DISMISSED_KEY))) } catch { /* 存储不可用不影响页面。 */ }

    const refresh = () => {
      if (!active) return
      const editing = document.activeElement?.closest('form') || document.activeElement?.matches('input, textarea, iframe, [contenteditable="true"]')
      const standaloneApp = standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone
      setMode(!platform || installed || standaloneApp || !viewport.matches || editing
        ? null : getInstallMode(navigator, Boolean(promptRef.current)))
    }
    const onPrompt = (event: Event) => {
      if (platform !== 'android' || installed || standalone.matches) return
      // 原生提示仍由浏览器处理；没有此事件也要提供主动的手机安装指引。
      promptRef.current = event as InstallPromptEvent
      setFailed(false)
      void (event as InstallPromptEvent).userChoice.then(() => {
        if (!active) return
        promptRef.current = null
        dismiss()
        refresh()
      }).catch(() => { /* 点击备用入口时单独显示失败提示。 */ })
      refresh()
    }
    const onInstalled = () => {
      installed = true
      promptRef.current = null
      dismiss()
      refresh()
    }
    const onFocus = () => queueMicrotask(refresh)
    const onStorage = (event: StorageEvent) => {
      if (event.key === INSTALL_DISMISSED_KEY) setDismissed(isInstallDismissed(event.newValue))
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('storage', onStorage)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onFocus)
    standalone.addEventListener('change', refresh)
    viewport.addEventListener('change', refresh)
    const timer = window.setTimeout(() => setReady(true), 5000)
    refresh()
    return () => {
      active = false
      clearTimeout(timer)
      promptRef.current = null
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onFocus)
      standalone.removeEventListener('change', refresh)
      viewport.removeEventListener('change', refresh)
    }
  }, [])

  async function install() {
    const prompt = promptRef.current
    if (!prompt || busyRef.current) return
    // 浏览器事件只能消费一次；在 await 前取走，避免快速重复点击。
    promptRef.current = null
    busyRef.current = true
    setBusy(true)
    try {
      await prompt.prompt()
      await prompt.userChoice
      dismiss()
    } catch {
      setFailed(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return { mode, visible: ready && !dismissed && mode !== null, busy, failed, dismiss, install }
}
