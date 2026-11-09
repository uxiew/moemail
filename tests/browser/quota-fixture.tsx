"use client"
import { useEffect, useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThreeColumnLayout } from '@/components/emails/three-column-layout'
import { MessageList } from '@/components/emails/message-list'
import { SharedEmailPageClient } from '@/[locale]/shared/[token]/page-client'

export default function QuotaTest() {
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState('layout')
  const [mailbox, setMailbox] = useState('quota-one')
  useEffect(() => {
    const state = { calls: [] as string[], status: 200, hidden: false, delay: 0, configStatus: new URLSearchParams(location.search).has('config-failure') ? 503 : 200 }
    ;(window as any).__quota = state
    const original = window.fetch
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden })
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.origin)
      if (!url.pathname.startsWith('/api/')) return original(input, init)
      state.calls.push(url.pathname + url.search)
      if (url.pathname === '/api/auth/session') return Response.json({ user: { id: 'quota-test', roles: [{ name: 'duke' }] }, expires: '2099-01-01' })
      if (url.pathname === '/api/emails/send-permission') return Response.json({ canSend: false })
      if (url.pathname === '/api/config') { if (state.calls.filter(path => path === '/api/config').length > 10) return new Promise(() => {}); return state.configStatus === 200 ? Response.json({ emailDomains: 'example.com' }) : new Response(null, { status: state.configStatus }) }
      if (url.pathname === '/api/emails') return Response.json({ emails: ['quota-one', 'quota-two'].map(id => ({ id, address: `${id}@example.com`, createdAt: Date.now(), expiresAt: Date.now() + 600_000 })), nextCursor: null, total: 2 })
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay))
      if (state.status !== 200) return new Response(null, { status: state.status })
      return Response.json({ messages: [{ id: url.pathname + '-message', from_address: 'sender@example.com', subject: url.pathname, received_at: Date.now() }], nextCursor: null, total: 1 })
    }
    setReady(true)
    return () => { window.fetch = original; delete (document as any).hidden }
  }, [])
  if (!ready) return null
  return <SessionProvider session={{ user: { id: 'quota-test', roles: [{ name: 'duke' }] }, expires: '2099-01-01' }}>
    <nav>{['none', 'layout', 'messages', 'shared'].map(name => <button id={name} key={name} onClick={() => setMode(name)}>{name} | </button>)}<button id="switch-mailbox" onClick={() => setMailbox(mailbox === 'quota-one' ? 'quota-two' : 'quota-one')}>switch mailbox</button></nav>
    {mode === 'layout' && <ThreeColumnLayout />}
    {mode === 'messages' && <MessageList email={{ id: mailbox, address: `${mailbox}@example.com` }} messageType="received" onMessageSelect={() => {}} />}
    {mode === 'shared' && <SharedEmailPageClient email={{ id: 'quota-share', address: 'shared@example.com', createdAt: new Date(), expiresAt: new Date(Date.now() + 600_000) }} initialMessages={[]} initialNextCursor={null} initialTotal={0} token="quota-token" />}
  </SessionProvider>
}
