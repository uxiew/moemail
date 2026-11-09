"use client"

import { create } from "zustand"
import { Role, ROLES } from "@/lib/permissions"
import { EMAIL_CONFIG } from "@/config"
import { useEffect } from "react"

interface Config {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  emailDomainsArray: string[]
  adminContact: string
  maxEmails: number
}

interface ConfigStore {
  config: Config | null
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
}

const useConfigStore = create<ConfigStore>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  fetch: async () => {
    if (get().loading) return
    try {
      set({ loading: true, error: null })
      const res = await fetch("/api/config")
      if (!res.ok) throw new Error("获取配置失败")
      const data = await res.json() as Config
      set({
        config: {
          defaultRole: data.defaultRole || ROLES.CIVILIAN,
          emailDomains: data.emailDomains,
          emailDomainsArray: data.emailDomains.split(','),
          adminContact: data.adminContact || "",
          maxEmails: Number(data.maxEmails) || EMAIL_CONFIG.MAX_ACTIVE_EMAILS
        },
        loading: false
      })
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : "获取配置失败",
        loading: false 
      })
    }
  }
}))

export function useConfig() {
  const store = useConfigStore()
  const { config, fetch: fetchConfig } = store

  useEffect(() => {
    // loading 从 true 变回 false 不是重试信号，否则 401/503 会触发无限请求。
    if (!config) void fetchConfig()
  }, [config, fetchConfig])

  return store
} 