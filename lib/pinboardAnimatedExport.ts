import React from "react"
import type { components } from "@/lib/panoptikon"
import { useQueryClient } from "@tanstack/react-query"
import { $api, fetchClient } from "@/lib/api"
import { toast } from "@/components/ui/use-toast"
import { downloadURL } from "@/lib/download"
import { exportGuard, useExporting } from "@/lib/pinboardExportGuard"
import {
  buildCompositionDoc,
  buildItemCompositionDoc,
  composeRequestedSeconds,
  composeRows,
  longestSpanSeconds,
  resolveItemTime,
  type ComposeItemMeta,
  type ComposeLength,
  type ComposePreset,
  type CompositionDoc,
  type CompositionResult,
} from "@/lib/pinboardCompose"
import { parsePlacements, type PinPlacement } from "@/lib/pinboardGeometry"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"
import { probePinThumbnailSize, probePinVideoState } from "@/lib/pinboardMedia"
import { findBoardElement, findBoardViewport } from "@/lib/pinboardPreview"
import { useSelectedDBs } from "@/lib/state/database"
import {
  useGalleryPinBoardLayout,
  useGalleryPinProportional,
} from "@/lib/state/gallery"
import {
  usePinboardMosaicExtent,
  usePinboardMosaicLength,
  usePinboardMosaicSeamless,
} from "@/lib/state/pinboardMosaicPrefs"
import { useVideoComposeEnabled } from "@/lib/useClientConfig"
import { useVideoPresets } from "@/lib/useVideoPresets"
import { createMenuGuard } from "@/lib/menuGuard"
import {
  POLL_TIMEOUT_MS,
  errorDetail,
  followTranscodeJob,
  forgetTranscodeState,
  isTerminalState,
  jobIdFromSubmit,
  setTranscodeState,
  stateFromSubmit,
  type TranscodeState,
} from "@/lib/videoTranscode"
import { abandonJob, awaitTerminal, raceDeadline } from "@/lib/videoClip"

// The ANIMATED pinboard save (implementation plan §4 C8): the same board the
// mosaic export composites onto a canvas, rendered by the server into one
// video or animated image instead.
//
// Structurally `useMosaicExport`'s twin — one export at a time through the same
// `exportGuard` (handed over to a narrower guard of its own once the job is the
// server's, see `composeGuard`), one progress toast, one download, one receipt
// — with the composite happening on the other side of a job: build the document
// (lib/pinboardCompose.ts), POST it, follow the job through the SAME store and
// SSE machinery the clip export uses, download the artifact.
//
// Two things this cannot do that the canvas export can, and both are why the
// document is built at click time rather than kept around: it needs each pin's
// LIVE play state (a paused pin composes the frame it is parked on, a playing
// one a span, a closed one its on-screen thumbnail — see
// lib/pinboardCompose's resolveItemRendering), and it needs the chosen PRESET
// (a 720-tall animated-image preset
// solves a smaller canvas than an mp4 does — the server refuses an over-tall
// canvas rather than rescaling one, which is the whole pixel-for-pixel point).

type ItemMetadataResponse = components["schemas"]["ItemMetadataResponse"]

/** Ceiling for the in-progress toast; it is dismissed on every real outcome. */
const PROGRESS_TOAST_MS = 10 * 60 * 1000
const RECEIPT_TOAST_MS = 5000
// Long enough to actually read an ffmpeg stderr tail, and Radix pauses the
// timer while the pointer is over the toast (which copying requires anyway).
const ERROR_TOAST_MS = 30000

/**
 * The width every animated save asks for, read as the OUTPUT's width.
 *
 * There are no size rows here, unlike the canvas exports: a composition's
 * canvas is bounded by the server (side, area, and the preset's own height
 * cap) far below anything a size menu would offer, so the honest default is
 * "as large as this server will render" and the clamp loop inside the builder
 * is what finds it. Asking above the maximum side is deliberate — the loop
 * re-solves downward from here and stops at the first canvas that fits.
 */
const TARGET_WIDTH = 4096

/**
 * The JOB half of an animated save, as a guard of its own.
 *
 * `exportGuard` is the app's single re-entrancy flag for work that runs HERE —
 * a full-resolution canvas, a twelve-pin metadata resolve, a document being
 * POSTed — and holding it for the whole of a composition would freeze every
 * export surface in the app behind a render that runs on the SERVER and can
 * legitimately take minutes. There is nothing in this tab to protect during
 * that wait.
 *
 * What is still worth preventing is a second COMPOSITION: they are the
 * heaviest thing the pool takes, and two of them from one board is the same
 * accident a double-click is. So the guard is handed over at the moment the
 * POST is accepted — narrow, module-scoped for the reason lib/menuGuard.ts
 * documents, and consulted by the animated rows alone.
 */
const composeGuard = createMenuGuard()

/** True while a composition job this tab started is still running. */
export function useComposeBusy(): boolean {
  return composeGuard.useBusy()
}

/** True while any export — canvas, item or composition — is in flight. */
export function useAnimatedExporting(): boolean {
  const exporting = useExporting()
  const composing = useComposeBusy()
  return exporting || composing
}

/** The one-line description the progress toast carries while a job runs. */
export function composeProgressText(state: TranscodeState): string {
  switch (state.state) {
    case "queued":
      return state.position > 1 ? `Queued (#${state.position})` : "Queued"
    case "running":
      return state.progress == null
        ? "Rendering…"
        : `Rendering… ${Math.round(state.progress * 100)}%`
    case "done":
      return "Saving…"
    default:
      return "Contacting the server"
  }
}

/**
 * The store key one composition job is followed under.
 *
 * Unlike a clip's, this key CANNOT be computed before the POST: a composition
 * is addressed by the hash of its whole document, which only the server
 * computes. So the job's own id names it. The playback keys are `sha:preset`
 * and the clip keys `sha:preset:window`, both beginning with a hex hash, so a
 * `compose:` prefix cannot collide with either — which is what lets all three
 * live in one store with one SSE implementation.
 */
export function composeStoreKey(jobId: string): string {
  return `compose:${jobId}`
}

/**
 * The name to save the bytes under when the server sent none. Only reachable
 * against an older gateway, or a payload the defensive parse could not read.
 * The extension matters (the `download` attribute IS the filename); the stem
 * only has to be unambiguous, and it matches the server's own scheme.
 */
function fallbackFileName(items: number, ext: string): string {
  return `mosaic-${items}items.${ext}`
}

export interface AnimatedExportRequest {
  preset: ComposePreset & { ext: string }
  /** The row's own label, so the toasts name what was pressed. */
  rowLabel: string
  /** Built at click time — see the header. */
  build: () => Promise<CompositionResult> | CompositionResult
  dbs: { index_db: string | null; user_data_db: string | null }
}

/**
 * Build, POST, follow, download, report.
 *
 * TWO guards, held over two different stretches. `exportGuard` — the app-wide
 * one — is taken BEFORE the document is built (a second click during a
 * twelve-pin metadata resolve is the same accident as one during an encode)
 * and released the moment the POST is answered: everything it protects has
 * happened by then, and the rest of this function is a wait on a server. From
 * there `composeGuard` takes over, which only the animated rows consult (see
 * above). Both are cleared in a `finally` the deadline race cannot outlive —
 * the reason `awaitTerminal` hands back its `cancel` and `raceDeadline` clears
 * its timer: a wait with no deadline would hold a guard for the life of the
 * tab.
 */
export async function exportAnimatedComposition(
  options: AnimatedExportRequest
): Promise<void> {
  const { preset, rowLabel, build, dbs } = options
  if (exportGuard.busy || composeGuard.busy) return
  exportGuard.set(true)
  let holding = true
  const release = () => {
    if (!holding) return
    holding = false
    exportGuard.set(false)
  }
  // The store entry this job is followed under, once there is one — dropped in
  // the finally, since a job id is a UUID and its key can never be reused.
  let storeKey: string | null = null

  const progress = toast({
    title: `Preparing ${rowLabel}…`,
    description: "Composing the document",
    duration: PROGRESS_TOAST_MS,
  })
  const step = (description: string) =>
    progress.update({ id: progress.id, description })
  // Terminal toasts REPLACE the progress one rather than mutating it: a
  // dismiss-and-reissue re-arms the auto-dismiss timer an in-place duration
  // change would leave sitting at ten minutes.
  const finish = (title: string, description: string, duration: number) => {
    progress.dismiss()
    toast({ title, description, duration })
  }
  // `copyText` buys the failure toast the wrap-and-scroll body and the copy
  // button: an ffmpeg stderr tail is unreadable clipped and useless
  // untranscribable.
  const fail = (detail: string) => {
    progress.dismiss()
    toast({
      title: "Animated save failed",
      description: detail,
      duration: ERROR_TOAST_MS,
      copyText: detail,
    })
  }

  try {
    const built = await build()
    if (!built.ok) {
      // The builder's refusals are written to be read: they name the limit
      // that was hit and what to do about it.
      fail(built.detail)
      return
    }
    const doc = built.doc
    step("Contacting the server")

    const { data, error } = await fetchClient.POST("/api/video/compose", {
      params: { query: { ...dbs } },
      body: doc.body,
    })
    if (error || !data) {
      // Shown VERBATIM: the server's 422s carry the numbers that explain them
      // (the loop-memory guard's estimate above all, which tells the user to
      // shorten the cap rather than to try again).
      fail(errorDetail(error, "The server refused the composition"))
      return
    }
    let state = stateFromSubmit(data)
    if (!isTerminalState(state)) {
      const jobId = jobIdFromSubmit(data)
      if (!jobId) {
        fail("The server sent no job id")
        return
      }
      // The document is on the server's books: hand the app-wide guard back
      // and hold only the composition one for the wait.
      composeGuard.set(true)
      release()
      const key = composeStoreKey(jobId)
      storeKey = key
      setTranscodeState(key, state)
      followTranscodeJob(key, jobId)
      const wait = awaitTerminal(key, (next) => step(composeProgressText(next)))
      state = await raceDeadline(wait.promise, POLL_TIMEOUT_MS, () => {
        wait.cancel()
        abandonJob(jobId)
        const timedOut: TranscodeState = {
          state: "failed",
          error: "Gave up waiting for the composition",
          sticky: false,
        }
        setTranscodeState(key, timedOut)
        return timedOut
      })
    }
    if (state.state === "failed") {
      fail(state.error)
      return
    }
    if (state.state !== "done") {
      fail("The composition did not finish")
      return
    }
    const filename =
      state.filename ?? fallbackFileName(doc.body.items.length, preset.ext)
    downloadURL(state.artifactUrl, filename)
    finish("Animated save complete", receipt(doc, filename), RECEIPT_TOAST_MS)
  } catch {
    fail("The composition request failed")
  } finally {
    release()
    composeGuard.set(false)
    // The verdict has been consumed (downloaded, or said out loud in a toast),
    // and nothing can ask for this job again — the next save mints a new id.
    if (storeKey) forgetTranscodeState(storeKey)
  }
}

/**
 * What actually landed. Skipped pins are NAMED (as a count — the shas mean
 * nothing to a reader) rather than silently dropped: a mosaic quietly missing
 * two items looks like a bug in the arrangement.
 *
 * Two causes wear one word, because the fix is the same either way: a pin
 * whose metadata never arrived, and one the capture edge cut down to a sliver.
 */
function receipt(doc: CompositionDoc, filename: string): string {
  const parts = [`${doc.width}×${doc.height}`, `${doc.body.items.length} items`]
  if (doc.skipped.length > 0) {
    parts.push(
      doc.skipped.length === 1
        ? "1 pin omitted (unavailable, or cut off)"
        : `${doc.skipped.length} pins omitted (unavailable, or cut off)`
    )
  }
  return `${filename} — ${parts.join(", ")}`
}

// ---- the scope: what the rows are about --------------------------------

/**
 * The item metadata one composition needs, read from the query cache the pins
 * already filled.
 *
 * `ensureQueryData` on the SAME query key the pin components use, so a board
 * on screen resolves without a single request; an unmounted board (the tab
 * chevron, the fullscreen bar) pays one cheap fetch per unique item, which is
 * exactly what it would have paid to render.
 */
function useItemMetaLoader(dbs: {
  index_db: string | null
  user_data_db: string | null
}): (sha256: string) => Promise<ComposeItemMeta | null> {
  const queryClient = useQueryClient()
  return React.useCallback(
    async (sha256: string) => {
      const data = await queryClient.ensureQueryData(
        $api.queryOptions("get", "/api/items/item", {
          params: { query: { ...dbs, id: sha256, id_type: "sha256" } },
        })
      )
      return data?.item ?? null
    },
    [queryClient, dbs]
  )
}

/**
 * Cached item metadata for one sha, WITHOUT fetching.
 *
 * The gate below runs on every render of an open menu, and a gate that fetched
 * would turn opening a menu into N requests for an answer it only needs to be
 * approximately right about. A cache miss is simply "not known here", which
 * the DOM fallback covers.
 */
function cachedItemMeta(
  queryClient: ReturnType<typeof useQueryClient>,
  dbs: { index_db: string | null; user_data_db: string | null },
  sha256: string
): ComposeItemMeta | null {
  const options = $api.queryOptions("get", "/api/items/item", {
    params: { query: { ...dbs, id: sha256, id_type: "sha256" } },
  })
  const data = queryClient.getQueryData<ItemMetadataResponse>(options.queryKey)
  return data?.item ?? null
}

/** Whether any pin in scope is rendering a video element right now. */
function anyPinPlayable(placements: readonly PinPlacement[]): boolean {
  if (typeof document === "undefined") return false
  return placements.some((p) => {
    try {
      return !!document.querySelector(
        `[data-pin-key="${CSS.escape(p.key)}"] [data-playable]`
      )
    } catch {
      return false
    }
  })
}

export interface ComposeScope {
  /** The placements the rows would compose, in board order. */
  placements: PinPlacement[]
  /**
   * At least one of them can PLAY — a video, or an animated image the server
   * can decode as a span — otherwise there is nothing to animate.
   */
  hasVideo: boolean
  /** How long the output would run, for the animated-image row's length cap. */
  requestedSeconds: number
}

/**
 * What the animated rows are about: which pins, and how long.
 *
 * Both answers are read at RENDER time from the live board, the query cache
 * and the DOM, and neither is load-bearing for correctness — the document is
 * rebuilt from scratch on click. `hasVideo` decides whether the section
 * appears at all (a board of photographs has nothing to animate) and
 * `requestedSeconds` decides whether the animated-image row does (an over-long
 * WebP is silently truncated by the server, so the row is hidden instead).
 *
 * The metadata read never fetches; a board whose items are not in the cache
 * falls back to the DOM's `data-playable` marker, which is on exactly the pins
 * that mounted a player.
 */
export function useComposeScope(
  keys: readonly string[] | null,
  length: ComposeLength
): ComposeScope {
  const [layout] = useGalleryPinBoardLayout()
  const [proportional] = useGalleryPinProportional()
  const dbs = useSelectedDBs()[0]
  const queryClient = useQueryClient()
  // The same envelope the rows themselves are built from (one fetch per
  // session through the query cache), for the animated-image capability list
  // the classification below reads.
  const { limits } = useVideoPresets("mosaic")
  const spanMimes = limits?.span_capable_image_mimes ?? []

  const boardWidth = measuredWidth()
  const parsed = parseBoard(layout)
  const grid = effectiveGrid(
    parsed.grid,
    gridScale(proportional, parsed.refWidth, boardWidth)
  )
  const placements = parsePlacements(
    parsed.records,
    grid,
    boardWidth,
    false,
    keys ? new Set(keys) : undefined
  )

  const metas = placements.map((p) => cachedItemMeta(queryClient, dbs, p.sha256))
  const times = placements.map((placement, i) => {
    const meta = metas[i]
    return resolveItemTime({
      isVideo: (meta?.type ?? "").startsWith("video/"),
      trim: placement.trim,
      state: probePinVideoState(placement.key),
      duration: meta?.duration ?? null,
      mime: meta?.type ?? null,
      spanCapableImageMimes: spanMimes,
    })
  })
  // Any signal alone is enough, and none is checked first: the cache is
  // partial by nature (a board whose first pin resolved and whose video pin has
  // not would read as "no video" if a single cache hit were taken as the whole
  // answer), and the DOM marker is a POSITIVE fact — a mounted player is a
  // video whatever the cache knows about it. A span-classified animated image
  // counts too (docs/animated-image-spans-design.md §6): a board of GIFs has
  // something to animate even though no pin ever mounts a player.
  const hasVideo =
    metas.some((meta) => (meta?.type ?? "").startsWith("video/")) ||
    anyPinPlayable(placements) ||
    times.some((time) => time.kind === "span")
  return {
    placements,
    hasVideo,
    requestedSeconds: composeRequestedSeconds(length, longestSpanSeconds(times)),
  }
}

/**
 * Non-zero measurement, or the window as the unmounted-board fallback — the
 * same trade PinboardMosaicMenu documents for the canvas export.
 */
function measuredWidth(): number {
  if (typeof window === "undefined") return 0
  const measured = findBoardElement()?.clientWidth
  return measured && measured > 0 ? measured : window.innerWidth
}

function measuredHeight(): number {
  if (typeof window === "undefined") return 0
  const measured = findBoardViewport()?.clientHeight
  return measured && measured > 0 ? measured : window.innerHeight
}

function pageBackground(): string {
  if (typeof document === "undefined") return "#09090b"
  return getComputedStyle(document.body).backgroundColor || "#09090b"
}

export interface AnimatedRowSet {
  /** The rows to render, already filtered by capability and length. */
  rows: { preset: ComposePreset & { ext: string }; label: string }[]
  /** The section is shown at all. */
  visible: boolean
  busy: boolean
  save: (preset: ComposePreset & { ext: string }, label: string) => void
}

/**
 * The animated rows for a BOARD (or a selection of one), ready to render.
 *
 * `keys` null is the whole board — which then honours the mosaic extent
 * preference; a selection always captures in full, since the chosen items ARE
 * the extent.
 */
export function useAnimatedMosaicExport(
  keys: readonly string[] | null
): AnimatedRowSet {
  const [layout] = useGalleryPinBoardLayout()
  const [proportional] = useGalleryPinProportional()
  const [seamless] = usePinboardMosaicSeamless()
  const [extent] = usePinboardMosaicExtent()
  const [length] = usePinboardMosaicLength()
  const dbs = useSelectedDBs()[0]
  const enabled = useVideoComposeEnabled()
  const { presets, limits } = useVideoPresets("mosaic")
  const getMeta = useItemMetaLoader(dbs)
  // Both guards: a canvas export in this tab, or a composition already
  // rendering on the server (see composeGuard). Never `useExporting() ||
  // useComposeBusy()`: `||` short-circuits the second HOOK call the moment
  // the first guard trips, which shifts every hook after it and crashes the
  // re-render the trip itself just forced.
  const busy = useAnimatedExporting()
  const scope = useComposeScope(keys, length)

  const save = (preset: ComposePreset & { ext: string }, label: string) => {
    const only = keys ? new Set(keys) : undefined
    void exportAnimatedComposition({
      preset,
      rowLabel: label,
      dbs,
      build: () =>
        buildCompositionDoc({
          layout,
          boardWidth: measuredWidth(),
          boardHeight: measuredHeight(),
          preset,
          limits,
          length,
          targetWidth: TARGET_WIDTH,
          // The target names the FILE's width, never the width the board is
          // laid out at: a selection is some fraction of the board, and the
          // whole-board case is the same request read the same way.
          widthMode: "output",
          seamless,
          extent: only ? "full" : extent,
          only,
          proportional,
          background: pageBackground(),
          getMeta,
          probe: probePinVideoState,
          thumb: probePinThumbnailSize,
        }),
    })
  }

  return {
    rows: composeRowsFor(presets, scope.requestedSeconds, limits),
    visible: enabled && scope.hasVideo && scope.placements.length > 0,
    busy,
    save,
  }
}

/**
 * The animated rows for ONE pin: the item itself, cropped and oriented exactly
 * as the board shows it, as a video.
 *
 * Offered only while the pin resolves to a SPAN — the RESOLVED time kind,
 * deliberately, not "is it a video": an animated GIF/WebP/AVIF the server can
 * decode resolves to a span with no <video> element at all and saves as a
 * looping clip, while a stopped pin's frozen frame (and a genuine still) is a
 * still image the existing image export serves better than a one-second video
 * would. That is also why this hook probes the pin's state itself rather than
 * taking the section's word for it: "does this one resolve to a span" is the
 * entire gate.
 */
export function useAnimatedItemExport(key: string | null): AnimatedRowSet {
  const [layout] = useGalleryPinBoardLayout()
  const [proportional] = useGalleryPinProportional()
  const [length] = usePinboardMosaicLength()
  const dbs = useSelectedDBs()[0]
  const enabled = useVideoComposeEnabled()
  const { presets, limits } = useVideoPresets("mosaic")
  const queryClient = useQueryClient()
  const getMeta = useItemMetaLoader(dbs)
  // Both guards: a canvas export in this tab, or a composition already
  // rendering on the server (see composeGuard). Never `useExporting() ||
  // useComposeBusy()`: `||` short-circuits the second HOOK call the moment
  // the first guard trips, which shifts every hook after it and crashes the
  // re-render the trip itself just forced.
  const busy = useAnimatedExporting()

  const boardWidth = measuredWidth()
  const parsed = parseBoard(layout)
  const grid = effectiveGrid(
    parsed.grid,
    gridScale(proportional, parsed.refWidth, boardWidth)
  )
  const placement = key
    ? parsePlacements(parsed.records, grid, boardWidth, false, new Set([key]))[0]
    : undefined
  const meta = placement
    ? cachedItemMeta(queryClient, dbs, placement.sha256)
    : null
  const state = placement ? probePinVideoState(placement.key) : null
  const time = placement
    ? resolveItemTime({
        isVideo: (meta?.type ?? "").startsWith("video/"),
        trim: placement.trim,
        state,
        duration: meta?.duration ?? null,
        mime: meta?.type ?? null,
        spanCapableImageMimes: limits?.span_capable_image_mimes ?? [],
      })
    : null
  const isSpan = time?.kind === "span"
  const requestedSeconds = composeRequestedSeconds(
    length,
    longestSpanSeconds(time ? [time] : [])
  )

  const save = (preset: ComposePreset & { ext: string }, label: string) => {
    if (!placement) return
    void exportAnimatedComposition({
      preset,
      rowLabel: label,
      dbs,
      build: async () =>
        buildItemCompositionDoc({
          placement,
          // Re-read rather than reused: the cache read above is a render-time
          // approximation for the gate, and the document must not be built on
          // one.
          meta: await getMeta(placement.sha256),
          state: probePinVideoState(placement.key),
          preset,
          limits,
          length,
          // The crop region at the source's own resolution, exactly like the
          // still export; the server's own bounds shrink it if it must.
          targetWidth: null,
          background: pageBackground(),
        }),
    })
  }

  return {
    rows: composeRowsFor(presets, requestedSeconds, limits),
    visible: enabled && !!placement && isSpan,
    busy,
    save,
  }
}

/** `composeRows` bound to the presets hook's row type, which also carries `ext`. */
function composeRowsFor(
  presets: (ComposePreset & { ext: string })[],
  requestedSeconds: number,
  limits: ReturnType<typeof useVideoPresets>["limits"]
) {
  return composeRows(presets, { requestedSeconds, limits })
}
