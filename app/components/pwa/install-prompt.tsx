"use client"

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { cn } from '@/lib/utils'

export function InstallPrompt() {
  const t = useTranslations('common.install')
  const onLoginPage = usePathname()?.endsWith('/login')
  const { mode, visible, busy, failed, dismiss, install } = useInstallPrompt()
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => { if (!visible) setGuideOpen(false) }, [visible])

  useEffect(() => {
    // next-pwa 5 的自动注入依赖 Pages Router 的 main.js；App Router 在这里显式注册。
    if (process.env.NODE_ENV === 'production' && window.isSecureContext && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => { /* 注册失败时继续在线使用，不伪造安装成功。 */ })
    }
  }, [])

  if (!visible) return null

  return (
    <>
      <aside
        aria-label={t('title')}
        data-install-prompt
        data-install-mode={mode}
        className={cn('fixed inset-x-3 z-40 mx-auto max-w-md rounded-xl border border-primary/20 bg-background p-3 shadow-lg',
          onLoginPage ? 'top-[max(0.75rem,env(safe-area-inset-top))]' : 'bottom-[max(0.75rem,env(safe-area-inset-bottom))]')}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t('promptTitle')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('shortDescription')}</p>
          </div>
          <Button type="button" data-install-action className="h-11 shrink-0 px-3" disabled={busy}
            aria-label={mode === 'native' && !failed ? t('install') : t('showSteps')}
            onClick={() => mode === 'native' && !failed ? void install() : setGuideOpen(true)}>
            {busy ? t('waitingShort') : mode === 'native' && !failed ? t('installShort') : t('addShort')}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t('dismiss')} onClick={dismiss}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {failed && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">{t('failed')}</p>
        )}
      </aside>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t(mode === 'ios' ? 'iosDescription' : mode === 'embedded' ? 'embeddedDescription' : 'androidDescription')}</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
            {mode === 'ios' ? <>
              <li>{t('openSafari')}</li>
              <li>{t('share')} <Share className="inline h-4 w-4 align-text-bottom" aria-hidden="true" /></li>
              <li>{t('addHome')}</li>
              <li>{t('confirm')}</li>
            </> : <>
              {mode === 'embedded' && <li>{t('openExternalBrowser')}</li>}
              <li>{t('androidMenu')}</li>
              <li>{t('androidAdd')}</li>
              <li>{t('androidConfirm')}</li>
            </>}
          </ol>
          <Button type="button" className="h-11" onClick={() => { setGuideOpen(false); dismiss() }}>{t('gotIt')}</Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
