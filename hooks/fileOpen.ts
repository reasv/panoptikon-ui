"use client"

import { useQueryClient } from "@tanstack/react-query"
import { $api } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelay } from "@/lib/relayContext"
import { fetchItemRecord } from "@/lib/itemLookup"

// The pairing half of the file actions, on its own so useFileShare can reach
// the relay-pairing affordance without instantiating the open/reveal mutations
// it never calls — PinBoardCtx renders once per pin and holds both (§FIX 11).
export function useRelayPairing() {
  const { toast } = useToast()
  const relay = useRelay()
  const pairRelay = async () => {
    toast({ title: "Approve Relay in Panoptikon Desktop", description: "Desktop will show this Panoptikon endpoint and its suggested folders.", duration: 10000 })
    try {
      await relay.pair()
    } catch (error) {
      toast({
        title: "Relay pairing failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      })
    }
  }
  return {
    relayDetected: relay.detected,
    relayPaired: relay.paired,
    pairRelay,
  }
}

export function useFileOpenActions({ sha256, path }: { sha256: string, path?: string }) {
  const query = useSelectedDBs()[0]
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const clientConfig = useClientConfig()
  const relay = useRelay()
  const pairing = useRelayPairing()
  const { mutate: mutateFile } = $api.useMutation("post", "/api/open/file/{sha256}")
  const { mutate: mutateFolder } = $api.useMutation("post", "/api/open/folder/{sha256}")
  const disableBackendOpen = clientConfig.data?.disableBackendOpen || false

  // Cached (30 s) and shared with the share button's own lookup, so a click
  // costs at most one server-side stat of the file — a network round trip on
  // an SMB-mounted index (§FIX 9).
  const getPath = async () => {
    if (path) return path
    const data = await fetchItemRecord(queryClient, query, sha256)
    return data?.files[0]?.path
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
  return {
    openFile, showInFolder, openFileInBrowser, disableBackendOpen,
    relayDetected: pairing.relayDetected,
    relayPaired: pairing.relayPaired,
    relayPairing: relay.pairing,
    relayPairingPending: relay.pairingPending,
    actionTarget: relay.target,
    setActionTarget: relay.setTarget,
    pairRelay: pairing.pairRelay,
    refreshRelay: relay.refresh,
    relayEnabled: relay.paired,
  }
}
