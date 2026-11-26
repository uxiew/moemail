"use client"

import { useCallback, useId, useState } from "react"
import { signIn } from "next-auth/react"
import { useTranslations } from "next-intl"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, KeyRound, User2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Turnstile } from "@/components/auth/turnstile"

interface LoginFormProps {
  registrationEnabled?: boolean
  turnstile?: { enabled: boolean; siteKey: string; configured?: boolean }
}

type Field = 'username' | 'password' | 'confirmPassword'

export function LoginForm({ turnstile, registrationEnabled = false }: LoginFormProps) {
  const id = useId()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [turnstileToken, setTurnstileToken] = useState("")
  const [turnstileResetCounter, setTurnstileResetCounter] = useState(0)
  const [activeTab, setActiveTab] = useState('login')
  const { toast } = useToast()
  const t = useTranslations("auth.loginForm")
  const registering = registrationEnabled && activeTab === 'register'
  const tab = registering ? 'register' : 'login'
  const turnstileEnabled = turnstile?.enabled === true
  const turnstileMisconfigured = turnstileEnabled && (!turnstile?.siteKey || turnstile.configured === false)

  const resetTurnstile = useCallback(() => {
    setTurnstileToken("")
    setTurnstileResetCounter(previous => previous + 1)
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    const nextErrors: Partial<Record<Field, string>> = {}
    if (!username) nextErrors.username = t('errors.usernameRequired')
    else if (!/^[a-zA-Z0-9_-]{1,20}$/.test(username)) nextErrors.username = t('errors.usernameInvalid')
    if (!password) nextErrors.password = t('errors.passwordRequired')
    else if (password.length < 8) nextErrors.password = t('errors.passwordTooShort')
    if (registering) {
      if (!confirmPassword) nextErrors.confirmPassword = t('errors.confirmPasswordRequired')
      else if (password !== confirmPassword) nextErrors.confirmPassword = t('errors.passwordMismatch')
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    if (turnstileEnabled && !turnstileToken) {
      toast({ title: t('toast.turnstileRequired'), description: t('toast.turnstileRequiredDesc'), variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      if (registering) {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, turnstileToken }),
        })
        const data = await response.json() as { error?: string }
        if (!response.ok) throw new Error(data.error || t('toast.registerFailedDesc'))
        // Turnstile token 只能消费一次，注册成功后重新验证登录，不复用旧 token。
        setActiveTab('login')
        setPassword('')
        setConfirmPassword('')
        resetTurnstile()
        toast({ title: t('toast.registerSuccess'), description: t('toast.registerSuccessDesc') })
      } else {
        const result = await signIn('credentials', { username, password, turnstileToken, redirect: false })
        if (result?.error) throw new Error(result.code === 'rate_limited' ? '尝试过于频繁，请稍后再试。'
          : result.code === 'request_too_large' ? '登录请求过大，请检查输入内容。'
          : result.code === 'security_unavailable' ? '安全验证暂时不可用，请联系管理员。'
          : result.code === 'security_verification_failed' ? '安全验证未通过，请重新验证。' : t('toast.loginFailedDesc'))
        window.location.href = '/'
      }
    } catch (error) {
      toast({
        title: t(registering ? 'toast.registerFailed' : 'toast.loginFailed'),
        description: error instanceof Error ? error.message : t('toast.registerFailedDesc'),
        variant: 'destructive',
      })
      resetTurnstile()
    } finally {
      setLoading(false)
    }
  }

  const fields = [
    { name: 'username' as const, value: username, set: setUsername, type: 'text', Icon: User2, autocomplete: 'username' },
    { name: 'password' as const, value: password, set: setPassword, type: 'password', Icon: KeyRound, autocomplete: registering ? 'new-password' : 'current-password' },
    ...(registering ? [{ name: 'confirmPassword' as const, value: confirmPassword, set: setConfirmPassword, type: 'password', Icon: KeyRound, autocomplete: 'new-password' }] : []),
  ]

  return (
    <Card data-auth-card className="w-full max-w-lg border-2 border-primary/20">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl text-center bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">{t('title')}</CardTitle>
        <CardDescription className="text-center">{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <Tabs value={tab} onValueChange={value => { setActiveTab(value); setErrors({}); setPassword(''); setConfirmPassword(''); resetTurnstile() }}>
          {registrationEnabled && (
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login" disabled={loading}>{t('tabs.login')}</TabsTrigger>
              <TabsTrigger value="register" disabled={loading}>{t('tabs.register')}</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value={tab} className="mt-0" aria-label={t(`tabs.${tab}`)}>
            <form method="post" onSubmit={handleSubmit} className="space-y-4">
              <noscript><p>请启用 JavaScript 后登录，避免跳过安全验证。</p></noscript>
              {fields.map(({ name, value, set, type, Icon, autocomplete }) => (
                <div key={name} className="space-y-1.5">
                  <label htmlFor={`${id}-${name}`} className="sr-only">{t(`fields.${name}`)}</label>
                  <div className="relative">
                    <Icon className="absolute left-2.5 top-2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id={`${id}-${name}`} name={name} type={type} autoComplete={autocomplete}
                      placeholder={t(`fields.${name}`)} value={value} disabled={loading}
                      onChange={event => { set(event.target.value); setErrors({}) }}
                      aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
                      className={cn('h-9 pl-9 pr-3', errors[name] && 'border-destructive focus-visible:ring-destructive')}
                    />
                  </div>
                  {errors[name] && <p id={`${id}-${name}-error`} className="text-xs text-destructive">{errors[name]}</p>}
                </div>
              ))}
              {turnstileMisconfigured && <p role="alert" className="text-sm text-destructive">安全验证配置不完整，请联系管理员。</p>}
              {turnstileEnabled && !turnstileMisconfigured && turnstile && <Turnstile siteKey={turnstile.siteKey} action={tab === 'register' ? 'register' : 'login'} onVerify={setTurnstileToken} onExpire={resetTurnstile} resetSignal={turnstileResetCounter} />}
              <Button type="submit" className="w-full" disabled={loading || turnstileMisconfigured}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t(`actions.${tab}`)}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
