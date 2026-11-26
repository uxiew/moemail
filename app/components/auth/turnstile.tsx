"use client"

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface TurnstileProps {
  siteKey: string
  action: 'login' | 'register'
  onVerify: (token: string) => void
  onExpire?: () => void
  resetSignal?: number
  className?: string
}

export function Turnstile({ siteKey, action, onVerify, onExpire, resetSignal, className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const previousReset = useRef({ resetSignal, action, siteKey })
  const callbacks = useRef({ onVerify, onExpire })
  callbacks.current = { onVerify, onExpire }
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!siteKey) return
    let active = true
    let size: 'compact' | 'flexible' | undefined
    setFailed(false)
    callbacks.current.onVerify('')
    const remove = () => {
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
    const render = () => {
      if (!active || !containerRef.current || !window.turnstile) return
      const nextSize = containerRef.current.clientWidth < 300 ? 'compact' : 'flexible'
      if (widgetId.current !== null && size === nextSize) return
      remove()
      size = nextSize
      callbacks.current.onVerify('')
      try {
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey, action, theme: 'auto', size, retry: 'never',
          callback: (token: string) => { if (active) { setFailed(false); callbacks.current.onVerify(token) } },
          'error-callback': () => { if (active) { setFailed(true); callbacks.current.onVerify('') } },
          'expired-callback': () => { if (active) { callbacks.current.onVerify(''); callbacks.current.onExpire?.() } },
        })
      } catch { if (active) setFailed(true) }
    }
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]')
    if (script?.dataset.failed === 'true' && !window.turnstile) { script.remove(); script = null }
    const fresh = !script
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true; script.defer = true; script.dataset.turnstile = 'true'
    }
    const loaded = () => { script!.dataset.loaded = 'true'; render() }
    const errored = () => { script!.dataset.failed = 'true'; if (active) { setFailed(true); callbacks.current.onVerify('') } }
    script.addEventListener('load', loaded)
    script.addEventListener('error', errored)
    const observer = new ResizeObserver(render)
    if (containerRef.current) observer.observe(containerRef.current)
    if (window.turnstile) render()
    else if (fresh) document.head.appendChild(script)
    const timer = setTimeout(() => { if (active && widgetId.current === null) errored() }, 10_000)
    return () => {
      active = false
      clearTimeout(timer)
      observer.disconnect()
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', errored)
      remove()
    }
  }, [siteKey, action, retry])

  useEffect(() => {
    const previous = previousReset.current
    previousReset.current = { resetSignal, action, siteKey }
    if (previous.resetSignal === resetSignal || previous.action !== action || previous.siteKey !== siteKey) return
    if (widgetId.current !== null && window.turnstile) window.turnstile.reset(widgetId.current)
    callbacks.current.onVerify('')
  }, [resetSignal, action, siteKey])

  return <div className={cn('space-y-2', className)}>
    <div ref={containerRef} className="flex w-full justify-center" />
    {failed && <div role="alert" className="text-center text-sm text-destructive">
      <p>安全验证未能加载或完成，请重试。</p>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>重新验证</Button>
    </div>}
  </div>
}
