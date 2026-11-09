interface PollerOptions {
  url: string
  interval: number
  immediate?: boolean
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
  onResponse: (response: Response, cursor: string | undefined, signal: AbortSignal) => Promise<void>
  onSettled: () => void
}

export function createMessagePoller({
  url, interval, immediate = true, visibility = document, onResponse, onSettled,
}: PollerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let pending: Promise<void> | undefined
  let stopped = false
  let disposed = false
  let delay = interval

  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const stop = () => {
    stopped = true
    clearTimer()
  }

  const schedule = () => {
    if (!disposed && !stopped && !visibility.hidden) {
      timer = setTimeout(() => { void refresh() }, delay)
    }
  }

  const refresh = (cursor?: string): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (pending) return pending
    if (visibility.hidden) {
      onSettled()
      return Promise.resolve()
    }
    clearTimer()
    controller = new AbortController()
    const signal = controller.signal
    const requestUrl = new URL(url)
    if (cursor) requestUrl.searchParams.set('cursor', cursor)

    pending = Promise.resolve().then(async () => {
      try {
        if (disposed) return
        const response = await fetch(requestUrl, { signal })
        if (disposed) return
        if ([401, 403, 404, 410].includes(response.status)) stop()
        delay = response.ok ? interval : Math.min(delay * 2, 300_000)
        await onResponse(response, cursor, signal)
      } catch (error) {
        if (!signal.aborted) {
          delay = Math.min(delay * 2, 300_000)
          console.error('Failed to fetch messages:', error)
        }
      } finally {
        pending = undefined
        controller = undefined
        if (!disposed) {
          onSettled()
          schedule()
        }
      }
    })
    return pending
  }

  const onVisibilityChange = () => {
    clearTimer()
    // 权限/分享失效后的停止是永久的，不能因切回标签页而复活。
    if (!visibility.hidden && !stopped) void refresh()
  }
  visibility.addEventListener('visibilitychange', onVisibilityChange)
  if (immediate) void refresh()
  else schedule()

  return {
    refresh,
    stop,
    dispose() {
      disposed = true
      stop()
      controller?.abort()
      visibility.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
