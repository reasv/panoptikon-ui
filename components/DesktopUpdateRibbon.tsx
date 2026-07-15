"use client"

import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { useClientConfig } from "@/lib/useClientConfig"

type DesktopUpdateStatus = {
  available: boolean
  target_version: string | null
  ribbon_visible: boolean
}

async function updateRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init })
  if (!response.ok) throw new Error("Panoptikon Desktop did not accept the update action")
  return response
}

export function DesktopUpdateRibbon({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void }) {
  const clientConfig = useClientConfig()
  const enabled = clientConfig.data?.desktopShellAvailable === true
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ["desktopUpdateStatus"],
    enabled,
    queryFn: async () => (await updateRequest("/api/desktop/update-status")).json() as Promise<DesktopUpdateStatus>,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const act = async (path: string, body?: unknown) => {
    setError(null)
    try {
      await updateRequest(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      await status.refetch()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Desktop update action failed")
    }
  }

  const update = status.data
  const visible = Boolean(enabled && update?.available && update.ribbon_visible && update.target_version)
  useEffect(() => onVisibilityChange?.(visible), [onVisibilityChange, visible])
  if (!visible || !update?.target_version) return null

  return (
    <aside className="relative z-40 flex min-h-12 shrink-0 items-center justify-center gap-3 border-b border-orange-900/70 bg-orange-950/90 px-4 py-2 text-sm text-orange-50 shadow-md" aria-label="Desktop update available">
      <p className="text-center">
        <span className="font-semibold">Panoptikon Desktop {update.target_version} is available.</span>
        {error && <span className="ml-2 text-red-300" role="alert">{error}</span>}
      </p>
      <Button size="sm" className="h-8 bg-orange-600 text-white hover:bg-orange-500" onClick={() => act("/api/desktop/update-window/open")}>View update</Button>
      <button className="text-xs text-orange-200 underline underline-offset-4 hover:text-white" onClick={() => act("/api/desktop/update-ribbon/dismiss", { version: update.target_version })}>Don&apos;t show again for this version</button>
      <button className="rounded p-1 text-orange-200 hover:bg-orange-900 hover:text-white" aria-label="Hide until tomorrow" title="Hide until tomorrow" onClick={() => act("/api/desktop/update-ribbon/snooze")}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  )
}
