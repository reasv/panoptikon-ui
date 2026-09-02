"use client"

import React from "react"
import { $api } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { downloadURL } from "@/lib/download"
import { useRelay } from "@/lib/relayContext"
import { RelayFileTooLargeError, RelayStaleFileError, type RelayShareFile } from "@/lib/relayClient"
import { describeError, truncateShareFilename } from "@/lib/fileShareMeta"
import {
  artifactDownloadName,
  relayEligibleArtifact,
  type DeliverableArtifact,
} from "@/lib/artifactShareMeta"
import { useCopyAvailability } from "@/hooks/fileShare"

// "Copy, don't download" for TRANSCODE ARTIFACTS — the artifact-side twin of
// hooks/fileShare.ts's adaptive share verb, and deliberately the same two
// routes in the same precedence: the paired desktop Relay first (a real file
// on the USER's clipboard), the server host's own clipboard second (only
// useful when server and browser share a machine, which is the desktop case).
//
// The difference from the original-file path is what is being copied. An
// artifact is not an indexed item: it has no sha256 to resolve, no item record
// to fetch and no path the client could learn any other way — everything the
// two legs need rides on the `ArtifactRef` the job already returned. So there
// is no `resolveMeta` here and no lazy fetch; a delivery is pure I/O over
// values it was handed.

/**
 * The delivery seam: give it a finished artifact, it puts the file wherever
 * the copy mode says, and reports the outcome itself.
 *
 * Returns NULL when neither copy route exists (no relay copy feature, and a
 * policy with backend-open actions disabled, or a client config still in
 * flight). Callers read null as "copy mode is impossible here" and render
 * download verbs — which is why this is a null-able result rather than a
 * function that quietly downloads: a menu must be able to decide what its rows
 * SAY before anything is pressed.
 *
 * THE RETURNED `deliver` NEVER THROWS AND OWNS EVERY OUTCOME, including all
 * of its toasts (lib/videoClip.ts's `exportClip` relies on both halves of
 * that: it dismisses its progress toast, awaits this, and shows no receipt of
 * its own). A copy that cannot happen falls back to a download rather than
 * failing, and a copy that fails says so; either way the promise resolves.
 *
 * ONE DELIVERY AT A TIME, the same discipline hooks/fileShare.ts applies to an
 * original file (§FIX 1b) and for the same reason: a relay copy of an
 * already-cached multi-GB re-encode spends its whole first leg materializing
 * the artifact in the browser, during which nothing visibly happens until the
 * progress toast appears — so a double-click would start a SECOND full
 * materialization and a second upload of the identical bytes. A call made
 * while one is in flight returns immediately and says nothing (it is a
 * duplicate of a delivery that is already going to report its own outcome; a
 * toast here would only look like a second, failing copy). `busy` is the
 * render-side half, for callers that want to disable or spin their control.
 */
export function useArtifactDelivery(): {
  deliver: (artifact: DeliverableArtifact) => Promise<void>
  busy: boolean
} | null {
  const { toast } = useToast()
  const relay = useRelay()
  const { canCopyRelay, canCopyServer } = useCopyAvailability()
  const { mutateAsync: copyArtifactOnServer } = $api.useMutation(
    "post",
    "/api/open/clipboard/artifact"
  )

  // The fallback that is always available: the artifact URL is same-origin and
  // the bytes are already sitting in the cache the job wrote them to.
  const runDownload = React.useCallback((artifact: DeliverableArtifact) => {
    downloadURL(artifact.url, artifactDownloadName(artifact))
  }, [])

  // Relay copy, the same shape hooks/fileShare.ts's `copyViaRelay` has (one
  // lazily-created progress toast, updated in place, dismissed on every exit
  // and replaced by a single terminal toast) because it is the same verb over
  // the same client — only the file differs. The progress toast is created
  // LAZILY, on the materializing phase or the first upload tick, so a mapped
  // or cache-hit copy goes straight to the success toast and never flashes
  // "Copying…". The handle lives in a container object, not a bare `let`: a
  // variable assigned only inside callback closures is narrowed back to its
  // `null` initializer by the compiler's flow analysis.
  const copyViaRelay = React.useCallback(async (
    relayFile: RelayShareFile,
    artifact: DeliverableArtifact,
  ) => {
    const name = relayFile.filename
    const progress: { handle?: ReturnType<typeof toast> } = {}
    const show = (description: string) => {
      if (!progress.handle) progress.handle = toast({ title: `Copying ${name}…`, description, duration: 600_000 })
      else progress.handle.update({ id: progress.handle.id, title: `Copying ${name}…`, description })
    }
    try {
      await relay.share(relayFile, {
        // The relay has to materialize the file: the browser downloads the
        // artifact in full before a single upload tick can fire, so say so now
        // rather than leaving the UI silent for the whole first leg.
        onPhase: () => show("Preparing… (reading the file)"),
        onProgress: fraction => show(`${Math.round(fraction * 100)}%`),
      })
      progress.handle?.dismiss()
      toast({ title: `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      progress.handle?.dismiss()
      if (error instanceof RelayFileTooLargeError) {
        toast({ title: "File too large to copy — downloading instead", duration: 3500 })
        runDownload(artifact)
        return
      }
      if (error instanceof RelayStaleFileError) {
        // Reachable for an artifact too: the relay verifies the uploaded bytes
        // against the declared sha256, and the global LRU can evict and
        // re-create an entry between the job finishing and this fetch.
        toast({ title: "This file changed on disk — downloading instead", duration: 3500 })
        runDownload(artifact)
        return
      }
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }, [relay, runDownload, toast])

  // Server-side copy. The server has the artifact under its content-addressed
  // storage name and hardlinks a human-named view of it before writing its own
  // clipboard; its 500 message is user-presentable (headless host, missing
  // wl-copy/xclip, clipboard busy) and is surfaced verbatim.
  const copyViaServer = React.useCallback(async (artifact: DeliverableArtifact) => {
    const name = artifactDownloadName(artifact)
    try {
      // The endpoint takes the cache key and an optional download name and
      // NOTHING else — no db params: an artifact is addressed by key in a
      // cache that is not per-database, and the policy middleware supplies
      // everything else server-side.
      const response = await copyArtifactOnServer({
        params: {
          query: artifact.filename
            ? { key: artifact.key, name: artifact.filename }
            : { key: artifact.key },
        },
      })
      // The server hedges to "Attempting to copy to clipboard: …" when a
      // custom clipboard_command owns the outcome — it spawns the child and
      // never observes its exit. Repeating its own words keeps the UI from
      // asserting a completed copy the server did not confirm (§FIX 13).
      toast({ title: response?.message || `Copied ${name} to clipboard`, duration: 2500 })
    } catch (error) {
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    }
  }, [copyArtifactOnServer, toast])

  // The ref is the guard (synchronous, so two clicks in the same tick cannot
  // both pass); the state is only what a caller renders.
  const inFlight = React.useRef(false)
  const [busy, setBusy] = React.useState(false)

  const deliver = React.useCallback(async (artifact: DeliverableArtifact) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      // The per-artifact relay gate: a full 64-hex sha256 (null on a
      // pre-migration row), a known size and a non-empty host path, because
      // the Relay hash-verifies, size-checks and rejects an empty path before
      // anything else. Disqualified means fall THROUGH to the server copy —
      // never send a null hash the relay would hard-fail on.
      if (canCopyRelay && relayEligibleArtifact(artifact)) {
        await copyViaRelay({
          url: artifact.url,
          // A mapping hint that does not resolve on the relay's machine is
          // not an error: it earns a 409 bytes_required, which is the ordinary
          // upload path.
          path: artifact.path,
          sha256: artifact.sha256,
          // Over-long names are a hard 400 at the relay (255 BYTES ~ 85 CJK
          // characters, and an artifact name inherits the source's); its own
          // cache sanitizer truncates to the same ceiling anyway, so
          // pre-truncating costs nothing (§FIX 7).
          filename: truncateShareFilename(artifactDownloadName(artifact)),
          size: artifact.size,
        }, artifact)
        return
      }
      if (canCopyServer) {
        await copyViaServer(artifact)
        return
      }
      // Both gates dropped between the render that chose a Copy label and this
      // click. The press will produce a file in Downloads instead — a
      // materially different outcome, so it is announced rather than silently
      // substituted (§FIX 6).
      toast({ title: "Can't copy this file — downloading instead", duration: 3500 })
      runDownload(artifact)
    } catch (error) {
      // The contract is "never throws": every leg above already owns its own
      // failures, so reaching here means something outside them did (a toast
      // store, a synchronous DOM failure in the download). Say so and resolve.
      toast({ title: "Failed to copy file", description: describeError(error), variant: "destructive", duration: 5000 })
    } finally {
      // In `finally`, not after each leg: every arm above returns early, and a
      // guard that stayed set would wedge the control for the rest of the
      // session rather than for the duration of one delivery.
      inFlight.current = false
      setBusy(false)
    }
  }, [canCopyRelay, canCopyServer, copyViaRelay, copyViaServer, runDownload, toast])

  return canCopyRelay || canCopyServer ? { deliver, busy } : null
}
