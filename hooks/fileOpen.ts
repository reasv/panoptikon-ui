"use client"

import { useQueryClient } from "@tanstack/react-query"
import { $api } from "@/lib/api"
import { toast } from "@/components/ui/use-toast"
import { originalFileURL } from "@/lib/thumbnailURL"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelay } from "@/lib/relayContext"
import { fetchItemRecord } from "@/lib/itemLookup"
import type { CellFileRef } from "@/lib/state/cellActions"

// The pairing half of the file actions, on its own so useFileShare can reach
// the relay-pairing affordance without instantiating the open/reveal mutations
// it never calls — PinBoardCtx renders once per pin and holds both.
//
// The STANDALONE `toast()` rather than `useToast().toast`: the hook form
// registers a listener on the shared toast store per mount (and re-registers
// it on every toast, its effect being keyed on the toast state), and this hook
// sits under per-row components. The standalone function drives the same store
// with no subscription, and nothing here renders a toast.
export function useRelayPairing() {
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

/**
 * The file open/reveal actions with NO file bound to them: every verb takes
 * the file it acts on as an argument.
 *
 * This is the form CellActionsHost mounts — once for the whole page — so that
 * the per-row buttons need none of the hooks below (a `useQueryStates` for the
 * selected DBs, two mutation observers, the client-config query and a toast
 * listener EACH, on a surface that mounts sixty of them). `useFileOpenActions`
 * beneath it is the same thing with a file bound, kept for the single-instance
 * call sites (the pinboard's context menu) that read like the old API.
 */
export function useFileOpenRunner() {
  const query = useSelectedDBs()[0]
  const queryClient = useQueryClient()
  const clientConfig = useClientConfig()
  const relay = useRelay()
  const pairing = useRelayPairing()
  const { mutate: mutateFile } = $api.useMutation("post", "/api/open/file/{sha256}")
  const { mutate: mutateFolder } = $api.useMutation("post", "/api/open/folder/{sha256}")
  const disableBackendOpen = clientConfig.data?.disableBackendOpen || false

  // Cached (30 s) and shared with the share button's own lookup, so a click
  // costs at most one server-side stat of the file — a network round trip on
  // an SMB-mounted index.
  const getPath = async ({ sha256, path }: CellFileRef) => {
    if (path) return path
    const data = await fetchItemRecord(queryClient, query, sha256)
    return data?.files[0]?.path
  }

  const report = (title: string, error: unknown) => toast({
    title,
    description: error instanceof Error ? error.message : String(error),
    variant: "destructive",
  })

  const relayRun = async (action: "open_file" | "reveal_in_folder", file: CellFileRef) => {
    const actualPath = await getPath(file)
    if (!actualPath) throw new Error("File path is unavailable")
    await relay.run(action, actualPath)
  }

  const openFileInBrowser = (sha256: string) => window.open(originalFileURL(query, sha256), "_blank")
  const openFile = (file: CellFileRef) => {
    const { sha256, path } = file
    if (relay.paired && relay.target === "relay") {
      relayRun("open_file", file).catch(error => report("Failed to open file", error))
      return
    }
    if (disableBackendOpen) { openFileInBrowser(sha256); return }
    mutateFile(
      { params: { path: { sha256 }, query: { ...query, path } } },
      { onError: error => report("Failed to open file", error) },
    )
  }
  const showInFolder = (file: CellFileRef) => {
    const { sha256, path } = file
    if (relay.paired && relay.target === "relay") {
      relayRun("reveal_in_folder", file).catch(error => report("Failed to show file in folder", error))
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

/**
 * The file-bound form, for surfaces that mount ONE of these rather than one
 * per row. Per-row components must not use it — they read the host's
 * callbacks and flags instead (lib/state/cellActions.ts).
 */
export function useFileOpenActions({ sha256, path }: { sha256: string, path?: string }) {
  const runner = useFileOpenRunner()
  return {
    ...runner,
    openFile: () => runner.openFile({ sha256, path }),
    showInFolder: () => runner.showInFolder({ sha256, path }),
    openFileInBrowser: () => runner.openFileInBrowser(sha256),
  }
}
