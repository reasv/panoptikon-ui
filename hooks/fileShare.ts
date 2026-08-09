"use client"

import { $api, fetchClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL, downloadFileName, fileNameFromPath } from "@/lib/utils"
import { downloadURL } from "@/lib/download"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelay } from "@/lib/relayContext"
import { RelayFileTooLargeError, type RelayShareFile } from "@/lib/relayClient"
import { useFileOpenActions } from "@/hooks/fileOpen"

// The relay hash-verifies its uploads, so the copy action body needs an exact
// 64-char lowercase-hex sha256 — but the pinboard only carries a 10-char
// prefix (§FIX 1). resolveMeta returns the stored full hash; this gates the
// relay branch on it.
const isFullSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

// The adaptive share verb (docs/file-sharing-design.md "adaptive share
// button"). The primary click is Copy where a native path exists (relay paired
// with the copy feature, or a desktop-managed server whose backend-open is
// enabled) and Download otherwise. Download is always available as the
// alternate. Copy has no visible effect of its own, so every copy path shows a
// toast; Download rides the browser's own download UI.
export function useFileShare({ sha256, path, filename, size }: {
  sha256: string
  path?: string
  filename?: string
  size?: number
}) {
  const query = useSelectedDBs()[0]
  const { toast } = useToast()
  const clientConfig = useClientConfig()
  const relay = useRelay()
  // Reused for the relay-pairing affordance in the button's right-click menu.
  const openActions = useFileOpenActions({ sha256, path })
  const { mutateAsync: copyOnServer } = $api.useMutation("post", "/api/open/clipboard/{sha256}")
  const disableBackendOpen = clientConfig.data?.disableBackendOpen || false
  const desktopManaged = clientConfig.data?.desktopManaged || false

  const canCopyRelay = relay.canCopyFiles
  const canCopyServer = desktopManaged && !disableBackendOpen
  const primaryVerb: "copy" | "download" = canCopyRelay || canCopyServer ? "copy" : "download"

  // filename + size ride the relay action body; path is the mapping hint; the
  // resolved FULL sha256 is what the relay payload must carry (the pinboard
  // passes only a 10-char prefix — §FIX 1). Any value the caller passed wins,
  // otherwise one item fetch fills the gaps (reusing the same GET
  // /api/items/item that useFileOpenActions' getPath uses). size is left
  // undefined when unknown rather than coerced to 0, so the relay-eligibility
  // gate can disqualify a copy whose size the relay would hash/size-check-fail
  // on (§FIX 4).
  const resolveMeta = async (): Promise<{ path?: string, filename: string, size?: number, sha256: string }> => {
    let resolvedPath = path
    let resolvedName = filename
    let resolvedSize = size
    let resolvedSha = sha256
    if (!resolvedPath || resolvedName === undefined || resolvedSize === undefined) {
      const result = await fetchClient.GET("/api/items/item", {
        params: { query: { ...query, id_type: "sha256", id: sha256 } },
      })
      const file = result.data?.files[0]
      resolvedPath = resolvedPath ?? file?.path
      resolvedName = resolvedName ?? (file?.filename || (file?.path ? fileNameFromPath(file.path) : undefined))
      resolvedSize = resolvedSize ?? (result.data?.item.size ?? undefined)
      // The item fetch resolves a prefix sha256 to the stored full 64-hex hash.
      if (result.data?.item.sha256) resolvedSha = result.data.item.sha256
    }
    return {
      path: resolvedPath,
      filename: resolvedName || downloadFileName(resolvedPath, sha256),
      size: resolvedSize,
      sha256: resolvedSha,
    }
  }

  const describeError = (error: unknown): string => {
    if (error && typeof error === "object" && "detail" in error && typeof (error as any).detail === "string") {
      return (error as any).detail
    }
    return error instanceof Error ? error.message : String(error)
  }

  // Resolves the filename lazily (only on invocation, never per render) so the
  // saved file keeps its real name and extension even where the caller passed
  // no path — the pinboard's "Download original" (§FIX 5). getFileURL keeps
  // using the possibly-prefix sha256; the server resolves it.
  const download = async () => {
    const meta = await resolveMeta()
    downloadURL(getFileURL(query, "file", "sha256", sha256), meta.filename)
  }

  // Relay copy. Instant when the mapping resolves or the cache is warm; a
  // progress toast otherwise, driven by upload %, then a success toast. A file
  // over the relay's cache ceiling (413) silently falls back to Download. The
  // caller has already resolved a full-hash, known-size RelayShareFile through
  // the eligibility gate in execute().
  const copyViaRelay = async (relayFile: RelayShareFile) => {
    const name = relayFile.filename
    // The progress toast is created LAZILY — on the first upload progress event
    // — so an instant mapped/cache-hit copy (share resolves without ever
    // reporting progress) goes straight to the success toast and never flashes
    // "Copying…" (§FIX 7). One handle, updated in place then dismissed and
    // replaced by a single terminal toast (§0.11 / the PinboardExportMenu
    // pattern) so phase toasts never stack. Every exit dismisses it if created.
    // Held in a container object, not a bare `let`: a variable assigned only
    // inside the onProgress closure is narrowed back to its `null` initializer
    // by the compiler's flow analysis, but an object property keeps its
    // declared type across the closure boundary.
    const progress: { handle?: ReturnType<typeof toast> } = {}
    try {
      await relay.share(relayFile, {
        onProgress: fraction => {
          const description = `${Math.round(fraction * 100)}%`
          if (!progress.handle) progress.handle = toast({ title: `Copying ${name}…`, description, duration: 600_000 })
          else progress.handle.update({ id: progress.handle.id, title: `Copying ${name}…`, description })
        },
      })
      progress.handle?.dismiss()
      toast({ title: `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      progress.handle?.dismiss()
      if (error instanceof RelayFileTooLargeError) {
        toast({ title: "File too large to copy — downloading instead", duration: 3500 })
        await download()
        return
      }
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }

  // Server-side copy (desktop-managed local host). The server has the real path
  // and writes its own clipboard; its 500 message is user-presentable (headless
  // host, missing wl-copy/xclip, clipboard busy) and is surfaced verbatim.
  const copyViaServer = async () => {
    let name = filename
    try {
      if (name === undefined) name = (await resolveMeta()).filename
      await copyOnServer({ params: { path: { sha256 }, query: { ...query, path } } })
      toast({ title: `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }

  // FIX 1 + FIX 4 unified relay-eligibility gate. The relay hash-verifies and
  // size-checks the upload, so a relay copy is only attempted when resolveMeta
  // yields BOTH a full 64-hex sha256 (the pinboard passes a prefix) and a known
  // numeric size. If either is missing the relay branch is disqualified and we
  // fall through to server-copy (desktop-managed) or Download — never sending a
  // prefix hash or a bogus size:0 the relay would hard-fail on.
  const execute = async () => {
    if (canCopyRelay) {
      const meta = await resolveMeta()
      if (isFullSha256(meta.sha256) && meta.size !== undefined) {
        await copyViaRelay({
          url: getFileURL(query, "file", "sha256", sha256),
          path: meta.path ?? "",
          sha256: meta.sha256,
          filename: meta.filename,
          size: meta.size,
        })
        return
      }
    }
    if (canCopyServer) { void copyViaServer(); return }
    await download()
  }

  return {
    primaryVerb,
    execute,
    download,
    // A relay is on the network but not yet paired: the right-click menu offers
    // to start pairing, a second doorway into the existing flow.
    canPair: openActions.relayDetected && !openActions.relayPaired,
    pairRelay: openActions.pairRelay,
  }
}
