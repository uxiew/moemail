"use client"

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInstallPrompt } from '@/hooks/use-install-prompt'

export function InstallPrompt() {
  const t = useTranslations('common.install')
  const { mode, visible, busy, failed, dismiss, install } = useInstallPrompt()
  const [guideOpen, setGuideOpen] = useState(false)

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
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm rounded-xl border border-primary/20 bg-background p-4 shadow-lg"
      >
        <div className="flex items-start gap-3 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Download className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('title')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('description')}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 h-11 w-11" aria-label={t('dismiss')} onClick={dismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
        {failed ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">{t('failed')}</p>
        ) : (
          <Button type="button" className="mt-3 h-11 w-full" disabled={busy} onClick={() => mode === 'ios' ? setGuideOpen(true) : void install()}>
            {busy ? t('waiting') : mode === 'ios' ? t('showSteps') : t('install')}
          </Button>
        )}
      </aside>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('iosDescription')}</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
            <li>{t('openSafari')}</li>
            <li>{t('share')} <Share className="inline h-4 w-4 align-text-bottom" aria-hidden="true" /></li>
            <li>{t('addHome')}</li>
            <li>{t('confirm')}</li>
          </ol>
          <Button type="button" className="h-11" onClick={() => { setGuideOpen(false); dismiss() }}>{t('gotIt')}</Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
