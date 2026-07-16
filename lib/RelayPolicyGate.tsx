"use client"

import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import { useClientConfig } from "@/lib/useClientConfig"
import { RelayContext, inertRelayContext } from "@/lib/relayContext"

type Provider = ComponentType<{ children: ReactNode }>

export function RelayPolicyGate({ children }: { children: ReactNode }) {
  const clientConfig = useClientConfig().data
  // Desktop's managed server and its Relay are the same local installation.
  // Offering to pair them can never add a second file-action destination, so
  // do not even load the discovery bundle on that endpoint. A Desktop Relay
  // remains available when this UI belongs to a remote Server, whose client
  // config is not desktop-managed.
  const enabled = clientConfig?.relayEnabled === true && clientConfig.desktopManaged !== true
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
