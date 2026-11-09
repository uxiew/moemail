"use client"

import { useTheme } from 'next-themes'

export function EmailHtmlFrame({ html, title }: { html: string; title: string }) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const srcDoc = `<!DOCTYPE html>
<html><head><base target="_blank"><style>
  html, body {
    margin: 0; min-height: 100%; box-sizing: border-box;
    font-family: system-ui, -apple-system, sans-serif;
    color: ${dark ? '#fff' : '#000'};
    background: ${dark ? '#1a1a1a' : '#fff'};
  }
  body { padding: 20px; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  * { scrollbar-width: thin; scrollbar-color: rgba(130,109,217,0.3) transparent; }
</style></head><body>${html}</body></html>`

  // srcDoc 随 iframe 一起挂载，切换两封 HTML 相同的邮件也不会留下空白页面。
  return <iframe title={title} srcDoc={srcDoc} className="absolute inset-0 w-full h-full border-0 bg-transparent" sandbox="allow-same-origin allow-popups" />
}
