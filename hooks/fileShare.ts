"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { $api } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL, downloadFileName } from "@/lib/utils"
import { downloadURL } from "@/lib/download"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelay } from "@/lib/relayContext"
import { RelayFileTooLargeError, RelayStaleFileError, type RelayShareFile } from "@/lib/relayClient"
import { fetchItemRecord } from "@/lib/itemLookup"
import {
  describeError,
  isFullSha256,
  mergeShareMeta,
  truncateShareFilename,
  type ShareMetaFields,
} from "@/lib/fileShareMeta"
import { useRelayPairing } from "@/hooks/fileOpen"

type ShareMeta = { path?: string, filename: string, size?: number, sha256: string }

// Whether a copy-as-file can happen at all here, by route. Factored out of
// useFileShare because the artifact-side delivery (hooks/artifactShare.ts,
// "Copy, don't download") asks the identical question about a transcode
// artifact, and two spellings of this gate would be two policies.
//
// Neither answer says anything about a particular FILE — only about the
// routes available to this browser, this relay and this policy. The per-file
// eligibility (a full hash, a known size, a non-empty path) is a separate
// gate each caller applies to its own metadata.
export function useCopyAvailability(): { canCopyRelay: boolean, canCopyServer: boolean } {
  const clientConfig = useClientConfig()
  const relay = useRelay()
  const disableBackendOpen = clientConfig.data?.disableBackendOpen || false
  return {
    canCopyRelay: relay.canCopyFiles,
    // Backend-open availability is the server-copy gate (design §Resolution
    // paths: "Desktop-managed local (or backend open actions available)") — the
    // same admin-controlled policy signal Open/Reveal fall back on, covering the
    // bare local gateway a desktopManaged check would wrongly exclude. Strict
    // presence check: while the config is in flight the verb stays Download, so
    // a restricted policy never flashes a Copy it would then retract.
    canCopyServer: clientConfig.data !== undefined && !disableBackendOpen,
  }
}

// The adaptive share verb (docs/file-sharing-design.md "adaptive share
// button"). The primary click is Copy where a native path exists (relay paired
// with the copy feature, or a server whose backend-open actions are enabled)
// and Download otherwise. Download is always available as the
// alternate. Copy has no visible effect of its own, so every copy path shows a
// toast; Download rides the browser's own download UI.
export function useFileShare({ sha256, path, filename, size }: {
  sha256: string
  path?: string
  filename?: string
  size?: number
}) {
  const query = useSelectedDBs()[0]
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const relay = useRelay()
  // Only the pairing affordance for the button's right-click menu — NOT the
  // full useFileOpenActions, whose open/reveal mutations this hook never uses.
  // PinBoardCtx renders once PER PIN and already holds its own
  // useFileOpenActions, so a 200-pin board would otherwise instantiate 200
  // duplicate mutation pairs (§FIX 11).
  const pairing = useRelayPairing()
  const { mutateAsync: copyOnServer } = $api.useMutation("post", "/api/open/clipboard/{sha256}")

  const { canCopyRelay, canCopyServer } = useCopyAvailability()
  const primaryVerb: "copy" | "download" = canCopyRelay || canCopyServer ? "copy" : "download"

  // One invocation at a time. A relay copy of a multi-GB video spends its
  // whole first leg downloading the original; a user who clicks again because
  // nothing looks like it happened would start a SECOND full download and
  // upload under a second action_id. The ref is the guard (synchronous, so two
  // clicks in the same tick cannot both pass); the state is only what the
  // button renders (§FIX 1b).
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const begin = () => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    return true
  }
  const end = () => {
    inFlight.current = false
    setBusy(false)
  }

  // filename + size ride the relay action body; path is the mapping hint; the
  // resolved FULL sha256 is what the relay payload must carry (the pinboard
  // passes only a 10-char prefix — §FIX 1). Any value the caller passed wins,
  // otherwise one item fetch fills the gaps — served from the TanStack cache
  // that useFileOpenActions' getPath shares, so a click costs at most one
  // NAS-backed stat round trip (§FIX 9). size is left undefined when unknown
  // rather than coerced to 0, so the relay-eligibility gate can disqualify a
  // copy whose size the relay would hash/size-check-fail on (§FIX 4).
  const resolveMeta = async (): Promise<ShareMeta> => {
    let fetched: ShareMetaFields = {}
    if (!path || filename === undefined || size === undefined) {
      const data = await fetchItemRecord(queryClient, query, sha256)
      const file = data?.files[0]
      fetched = {
        path: file?.path,
        filename: file?.filename,
        size: data?.item.size ?? undefined,
        // The item fetch resolves a prefix sha256 to the stored full 64-hex hash.
        sha256: data?.item.sha256,
      }
    }
    const merged = mergeShareMeta({ sha256, path, filename, size }, fetched)
    return {
      path: merged.path,
      // Over-long names are a hard 400 at the relay (255 BYTES ~ 85 CJK
      // characters); its own cache sanitizer truncates to the same ceiling
      // anyway, so pre-truncating costs nothing (§FIX 7).
      filename: truncateShareFilename(merged.filename || downloadFileName(merged.path, sha256)),
      size: merged.size,
      sha256: merged.sha256,
    }
  }

  // Resolves the filename lazily (only on invocation, never per render) so the
  // saved file keeps its real name and extension even where the caller passed
  // no path — the pinboard's "Download original" (§FIX 5). getFileURL keeps
  // using the possibly-prefix sha256; the server resolves it. `meta` is passed
  // in on every path that already resolved it, so one invocation never fetches
  // the item twice.
  const runDownload = async (meta?: ShareMeta) => {
    const resolved = meta ?? await resolveMeta()
    downloadURL(getFileURL(query, "file", "sha256", sha256), resolved.filename)
  }

  // Relay copy. Instant when the mapping resolves or the cache is warm; a
  // progress toast otherwise, opened the moment the relay says it needs the
  // bytes and then driven by upload %, followed by a success toast. A file
  // over the relay's cache ceiling (413) silently falls back to Download. The
  // caller has already resolved a full-hash, known-size, non-empty-path
  // RelayShareFile through the eligibility gate in execute().
  const copyViaRelay = async (relayFile: RelayShareFile, meta: ShareMeta) => {
    const name = relayFile.filename
    // The progress toast is created LAZILY — on the materializing phase, or on
    // the first upload progress event — so an instant mapped/cache-hit copy
    // (share resolves without ever reporting either) goes straight to the
    // success toast and never flashes "Copying…" (§FIX 7 of the previous
    // round). One handle, updated in place then dismissed and replaced by a
    // single terminal toast (§0.11 / the PinboardExportMenu pattern) so phase
    // toasts never stack. Every exit dismisses it if created.
    // Held in a container object, not a bare `let`: a variable assigned only
    // inside the callback closures is narrowed back to its `null` initializer
    // by the compiler's flow analysis, but an object property keeps its
    // declared type across the closure boundary.
    const progress: { handle?: ReturnType<typeof toast> } = {}
    const show = (description: string) => {
      if (!progress.handle) progress.handle = toast({ title: `Copying ${name}…`, description, duration: 600_000 })
      else progress.handle.update({ id: progress.handle.id, title: `Copying ${name}…`, description })
    }
    try {
      await relay.share(relayFile, {
        // The relay has to materialize the file: a full download of the
        // original comes first and reports nothing, so say so now rather than
        // leaving the UI silent for the entire first leg (§FIX 1a).
        onPhase: () => show("Preparing… (reading the file)"),
        onProgress: fraction => show(`${Math.round(fraction * 100)}%`),
      })
      progress.handle?.dismiss()
      toast({ title: `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      progress.handle?.dismiss()
      if (error instanceof RelayFileTooLargeError) {
        toast({ title: "File too large to copy — downloading instead", duration: 3500 })
        await runDownload(meta)
        return
      }
      if (error instanceof RelayStaleFileError) {
        toast({ title: "This file changed on disk — downloading instead", duration: 3500 })
        await runDownload(meta)
        return
      }
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }

  // Server-side copy (desktop-managed local host). The server has the real path
  // and writes its own clipboard; its 500 message is user-presentable (headless
  // host, missing wl-copy/xclip, clipboard busy) and is surfaced verbatim.
  const copyViaServer = async (meta?: ShareMeta) => {
    let name = meta?.filename ?? filename
    try {
      if (name === undefined) name = (await resolveMeta()).filename
      const response = await copyOnServer({ params: { path: { sha256 }, query: { ...query, path } } })
      // The server hedges to "Attempting to copy to clipboard: …" when a
      // custom clipboard_command owns the outcome — it spawns the child and
      // never observes its exit. Repeating its own words keeps the UI from
      // asserting a completed copy the server did not confirm (§FIX 13).
      toast({ title: response?.message || `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }

  // FIX 1 + FIX 3 + FIX 4 unified relay-eligibility gate. The relay
  // hash-verifies and size-checks the upload and rejects an EMPTY path before
  // anything else, so a relay copy is only attempted when resolveMeta yields
  // all three of: a full 64-hex sha256 (the pinboard passes a prefix), a known
  // numeric size, and a non-empty server path (an item whose files are all
  // gone from disk comes back with an empty files[]). If any is missing the
  // relay branch is disqualified and we fall through to server-copy
  // (desktop-managed) or Download — never sending a prefix hash, a bogus
  // size:0 or an empty path the relay would hard-fail on.
  const runExecute = async () => {
    const meta = canCopyRelay ? await resolveMeta() : undefined
    if (meta && isFullSha256(meta.sha256) && meta.size !== undefined && !!meta.path) {
      await copyViaRelay({
        url: getFileURL(query, "file", "sha256", sha256),
        path: meta.path,
        sha256: meta.sha256,
        filename: meta.filename,
        size: meta.size,
      }, meta)
      return
    }
    if (canCopyServer) { await copyViaServer(meta); return }
    // The button said "Copy file" and this click will produce a file in
    // Downloads instead — a materially different outcome, so it is announced
    // rather than silently substituted (§FIX 6).
    if (primaryVerb === "copy") {
      toast({ title: "Can't copy this file — downloading instead", duration: 3500 })
    }
    await runDownload(meta)
  }

  // resolveMeta lives OUTSIDE the copy paths' own try/catch and fetchClient
  // rejects on a network failure or an abort, so both entry points wrap
  // everything: an unhandled rejection here means no toast, no download and a
  // button that looks dead (§FIX 5).
  const execute = async () => {
    if (!begin()) return
    try {
      await runExecute()
    } catch (error) {
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    } finally {
      end()
    }
  }

  const download = async (meta?: ShareMeta) => {
    if (!begin()) return
    try {
      await runDownload(meta)
    } catch (error) {
      toast({ title: "Failed to download file", description: describeError(error), variant: "destructive", duration: 5000 })
    } finally {
      end()
    }
  }

  return {
    primaryVerb,
    execute,
    download,
    // An invocation is running: the button disables itself so a second click
    // cannot start a second multi-GB transfer.
    busy,
    // A relay is on the network but not yet paired: the right-click menu offers
    // to start pairing, a second doorway into the existing flow.
    canPair: pairing.relayDetected && !pairing.relayPaired,
    pairRelay: pairing.pairRelay,
  }
}
