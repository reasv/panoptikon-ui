"use client"

import { $api, fetchClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelay } from "@/lib/relayContext"

export function useFileOpenActions({ sha256, path }: { sha256: string, path?: string }) {
  const query = useSelectedDBs()[0]
  const { toast } = useToast()
  const clientConfig = useClientConfig()
  const relay = useRelay()
  const { mutate: mutateFile } = $api.useMutation("post", "/api/open/file/{sha256}")
  const { mutate: mutateFolder } = $api.useMutation("post", "/api/open/folder/{sha256}")
  const disableBackendOpen = clientConfig.data?.disableBackendOpen || false

  const getPath = async () => {
    if (path) return path
    const result = await fetchClient.GET("/api/items/item", {
      params: { query: { ...query, id_type: "sha256", id: sha256 } },
    })
    return result.data?.files[0]?.path
  }

  const report = (title: string, error: unknown) => toast({
    title,
    description: error instanceof Error ? error.message : String(error),
    variant: "destructive",
  })

  const relayRun = async (action: "open_file" | "reveal_in_folder") => {
    const actualPath = await getPath()
    if (!actualPath) throw new Error("File path is unavailable")
    await relay.run(action, actualPath)
  }

  const openFileInBrowser = () => window.open(getFileURL(query, "file", "sha256", sha256), "_blank")
  const openFile = () => {
    if (relay.paired && relay.target === "relay") {
      relayRun("open_file").catch(error => report("Failed to open file", error))
      return
    }
    if (disableBackendOpen) { openFileInBrowser(); return }
    mutateFile(
      { params: { path: { sha256 }, query: { ...query, path } } },
      { onError: error => report("Failed to open file", error) },
    )
  }
  const showInFolder = () => {
    if (relay.paired && relay.target === "relay") {
      relayRun("reveal_in_folder").catch(error => report("Failed to show file in folder", error))
      return
    }
    mutateFolder(
      { params: { path: { sha256 }, query: { ...query, path } } },
      { onError: error => report("Failed to show file in folder", error) },
    )
  }
  const pairRelay = async () => {
    toast({ title: "Approve Relay in Panoptikon Desktop", description: "Desktop will show this Panoptikon endpoint and its suggested folders.", duration: 10000 })
    try { await relay.pair() } catch (error) { report("Relay pairing failed", error) }
  }

  return {
    openFile, showInFolder, openFileInBrowser, disableBackendOpen,
    relayDetected: relay.detected,
    relayPaired: relay.paired,
    relayPairing: relay.pairing,
    relayPairingPending: relay.pairingPending,
    actionTarget: relay.target,
    setActionTarget: relay.setTarget,
    pairRelay,
    refreshRelay: relay.refresh,
    relayEnabled: relay.paired,
  }
}
