"use client"
import { $api, fetchClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useEffect, useState } from "react"
import type { RelaySession } from "@/lib/relayClient"

type Target = "relay" | "host"

export function useFileOpenActions({ sha256, path }: { sha256: string, path?: string }) {
  const query = useSelectedDBs()[0]
  const { toast } = useToast()
  const clientConfig = useClientConfig()
  const [relay, setRelay] = useState<RelaySession | null>(null)
  const [target, setTargetState] = useState<Target>("relay")
  const { mutate: mutateFile } = $api.useMutation("post", "/api/open/file/{sha256}")
  const { mutate: mutateFolder } = $api.useMutation("post", "/api/open/folder/{sha256}")
  const disableBackendOpen = clientConfig?.data?.disableBackendOpen || false
  const relayPolicyEnabled = clientConfig?.data?.relayEnabled === true

  useEffect(() => {
    if (!relayPolicyEnabled) return
    let live = true
    const refresh = () => import("@/lib/relayClient").then(module => module.discoverRelay()).then(value => {
      if (!live) return
      setRelay(value)
      if (value?.credential && localStorage.getItem("panoptikon-file-action-target") === "host") setTargetState("host")
    })
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { live = false; window.clearInterval(timer) }
  }, [relayPolicyEnabled])

  useEffect(() => {
    const sync = (event: Event) => setTargetState((event as CustomEvent<Target>).detail)
    window.addEventListener("panoptikon-file-action-target", sync)
    return () => window.removeEventListener("panoptikon-file-action-target", sync)
  }, [])

  const setTarget = (value: Target) => {
    setTargetState(value)
    localStorage.setItem("panoptikon-file-action-target", value)
    window.dispatchEvent(new CustomEvent("panoptikon-file-action-target", { detail: value }))
  }

  const getPath = async () => {
    if (path) return path
    const result = await fetchClient.GET("/api/items/item", { params: { query: { ...query, id_type: "sha256", id: sha256 } } })
    return result.data?.files[0]?.path
  }

  const pair = async () => {
    if (!relay) return
    toast({ title: "Approve Relay in Panoptikon Desktop", description: "The Desktop window has the request and suggested server folders.", duration: 10000 })
    try {
      const stats = await fetchClient.GET("/api/search/stats", { params: { query } })
      const module = await import("@/lib/relayClient")
      const paired = await module.pairRelay(relay, stats.data?.folders ?? [])
      setRelay(paired)
      setTarget("relay")
      toast({ title: "Local Relay paired", description: "Open actions now run on this computer.", duration: 3000 })
    } catch (error: any) {
      toast({ title: "Relay pairing failed", description: error.message, variant: "destructive" })
    }
  }

  const openFileInBrowser = () => window.open(getFileURL(query, "file", "sha256", sha256), "_blank")
  const relayRun = async (verb: "file" | "folder") => {
    const actualPath = await getPath()
    if (!relay?.credential || !actualPath) throw new Error("File path is unavailable")
    const module = await import("@/lib/relayClient")
    await module.relayAction(relay, verb === "file" ? "open_file" : "reveal_in_folder", actualPath)
  }
  const report = (title: string, error: any) => toast({ title, description: error.message, variant: "destructive" })

  const openFile = () => {
    if (relay?.credential && target === "relay") { relayRun("file").catch(error => { if (error instanceof TypeError) setRelay(null); report("Failed to open file", error) }); return }
    if (disableBackendOpen) { openFileInBrowser(); return }
    mutateFile({ params: { path: { sha256 }, query: { ...query, path } } }, { onError: error => report("Failed to open file", error) })
  }
  const showInFolder = () => {
    if (relay?.credential && target === "relay") { relayRun("folder").catch(error => { if (error instanceof TypeError) setRelay(null); report("Failed to show file in folder", error) }); return }
    mutateFolder({ params: { path: { sha256 }, query: { ...query, path } } }, { onError: error => report("Failed to show file in folder", error) })
  }

  return {
    openFile, showInFolder, openFileInBrowser, disableBackendOpen,
    relayDetected: !!relay, relayPaired: !!relay?.credential, actionTarget: target, setActionTarget: setTarget, pairRelay: pair,
    relayEnabled: !!relay?.credential,
  }
}
