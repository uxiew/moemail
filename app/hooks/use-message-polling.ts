"use client"

import { useCallback, useEffect, useRef } from 'react'
import { EMAIL_CONFIG } from '@/config'
import { createMessagePoller } from '@/lib/message-poller'

export function useMessagePolling(
  url: string,
  onResponse: (response: Response, cursor: string | undefined, signal: AbortSignal) => Promise<void>,
  onSettled: () => void,
  immediate = true,
) {
  const callbacks = useRef({ onResponse, onSettled })
  const poller = useRef<ReturnType<typeof createMessagePoller> | null>(null)

  useEffect(() => { callbacks.current = { onResponse, onSettled } })

  useEffect(() => {
    const current = createMessagePoller({
      url: new URL(url, window.location.origin).toString(),
      interval: EMAIL_CONFIG.POLL_INTERVAL,
      immediate,
      onResponse: (response, cursor, signal) => callbacks.current.onResponse(response, cursor, signal),
      onSettled: () => callbacks.current.onSettled(),
    })
    poller.current = current
    return () => {
      current.dispose()
      poller.current = null
    }
  }, [url, immediate])

  const fetchMessages = useCallback((cursor?: string) => poller.current?.refresh(cursor) ?? Promise.resolve(), [])
  const stopPolling = useCallback(() => poller.current?.stop(), [])
  return { fetchMessages, stopPolling }
}
