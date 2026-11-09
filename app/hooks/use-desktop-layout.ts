"use client"

import { useEffect, useState } from 'react'

export function useDesktopLayout() {
  const [desktop, setDesktop] = useState<boolean | null>(null)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desktop
}
