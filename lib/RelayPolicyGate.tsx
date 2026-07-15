"use client"

import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import { useClientConfig } from "@/lib/useClientConfig"
import { RelayContext, inertRelayContext } from "@/lib/relayContext"

type Provider = ComponentType<{ children: ReactNode }>

export function RelayPolicyGate({ children }: { children: ReactNode }) {
  const enabled = useClientConfig().data?.relayEnabled === true
  const [Provider, setProvider] = useState<Provider | null>(null)

  useEffect(() => {
    let live = true
    if (!enabled) { setProvider(null); return () => { live = false } }
    import("@/lib/RelayProvider").then(module => {
      if (live) setProvider(() => module.RelayProvider)
    })
    return () => { live = false }
  }, [enabled])

  if (enabled && Provider) return <Provider>{children}</Provider>
  return <RelayContext.Provider value={inertRelayContext}>{children}</RelayContext.Provider>
}
