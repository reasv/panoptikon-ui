"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import {
  clearPlaceholderColour,
  isPlaceholderColour,
  type CellPlaceholder,
} from "@/lib/state/blurHashDataURL"
import type { CellVideoPicture } from "@/lib/cellPicture"
import { LoopVideo } from "@/components/LoopVideo"
import { CELL_HOVER_ROOT_ATTR, useArmedHover } from "@/hooks/useArmedHover"
import {
  notePreviewRungFailure,
  previewArmLadder,
  previewFeedback,
  previewOutroCut,
  previewRungFailures,
  rungAtStep,
  shouldRecordFailure,
  previewKey,
  previewRequest,
  releasePreviewTranscode,
  startPreviewTranscode,
  type PreviewFeedback,
  type PreviewJobRung,
} from "@/lib/videoPreview"
import { useTranscodeKeyState } from "@/lib/videoTranscode"
import { outroCutPoint, useVideoDuration, useVideoTrim } from "@/lib/videoTrim"
import { previewFrameShown, type CountdownPhase } from "@/lib/previewCountdown"
import type { HoverPreviewTrigger } from "@/lib/state/hoverPreviewTrigger"

/**
 * The picture of a VIDEO card whose cell may hover-PREVIEW
 * (docs/video-hover-preview-implementation.md V2/V12).
 *
 * ITS OWN MODULE because two surfaces mount it — the result grid's cards and
 * the gallery filmstrip's — and the contract below (what is requested and
 * when, who owns the hover, what a leave undoes) has to be the same wherever
 * it appears. Same reason components/LoopVideo.tsx is its own module.
 *
 * THREE LAYERS, and the point of all three is that leaving costs nothing to
 * undo:
 *
 *   1. the BASE `<img>`, which never unmounts — a small cell's single frame,
 *      a large one's 2x2 mosaic (the plan decides which, V12);
 *   2. in a large cell only, the SINGLE FRAME layered over it on plain
 *      `:hover`. It is the picture the preview will play over, and it arrives
 *      in the same moment as the card's own cover->contain zoom-out rather
 *      than as a second event after the dwell — the correction user QA made to
 *      the small cell's mosaic swap (D9), applied here in the other direction;
 *   3. the `<video>`, mounted only once the ARMED hover has fired (200 ms of
 *      real dwell, not scroll-suspended — on the CARD or on the play badge,
 *      whichever the trigger setting names, and after the badge's countdown in
 *      the latter case) and fading in on its first decoded frame. The two
 *      triggers converge here: whatever produced the start, what follows is
 *      the same ladder, the same requests and the same job.
 *      NOTHING IS REQUESTED BEFORE THAT: no `<video>` element exists,
 *      no transcode is submitted, and the grid as a whole issues zero video
 *      requests while the pointer is only passing over it.
 *
 * On leave the video simply unmounts — `LoopVideo`'s ref cleanup aborts the
 * fetch as well as the playback — and the base `<img>` underneath was never
 * disturbed, so there is nothing to repaint.
 *
 * MOUNTED ONLY FOR VIDEO CARDS WITH PREVIEWS ON, on the same structural rule
 * ExtremeAspectPicture and CellLoopPicture follow: with previews off
 * (preference, policy, an older Server, or a file this browser can show no way
 * at all) the plan is `videoSmall` or `still` and none of this exists — no
 * hook, no listener, no second element.
 */
export function VideoHoverPicture({
  picture,
  sha256,
  indexDb,
  userDataDb,
  duration,
  contentEndMs,
  outroSkip = false,
  alt,
  placeholder,
  className,
  elementRef,
  disabled,
  onFeedback,
  trigger = "card",
  armPhase = "idle",
}: {
  picture: CellVideoPicture
  sha256: string
  /**
   * The two selected databases as PRIMITIVES rather than the `dbs` object,
   * and that is about the effect below rather than about style: the object is
   * rebuilt by its own host, and an effect that re-ran on its identity would
   * cancel a live preview job and resubmit it for no change at all.
   */
  indexDb: string | null
  userDataDb: string | null
  /** The row's indexed duration in seconds — the 16 s cap's input (V3). */
  duration?: number | null
  /**
   * The row's detected outro boundary in ms (`content_end_ms`), null when
   * there is none or the database has detection off. With `outroSkip` it is
   * what keeps the TikTok end card out of the preview: the job rungs name the
   * cut for the server to resolve, and the direct rung loops at it in the
   * browser exactly as the gallery player does (docs/video-outro-skip-design.md).
   */
  contentEndMs?: number | null
  /**
   * The viewer's outro-skip preference (`useOutroSkipEnabled`), read once by
   * the surface and handed down like the capability. False when omitted, so
   * a surface that says nothing previews exactly what it always did.
   */
  outroSkip?: boolean
  alt: string
  /**
   * WHAT THE BASE POSTER PAINTS BEHIND ITSELF — one value in either form
   * (lib/state/blurHashDataURL.ts), computed once by the host from its tier
   * rung. The `<video>` layers never take it: the poster underneath IS the
   * placeholder by then, and a blur or a flat colour behind a layer fading in
   * over a painted picture is the flash the fade exists to avoid — the same
   * rule HoverLoopPicture states.
   */
  placeholder: CellPlaceholder | undefined
  /** The host's object-fit / rounding classes, applied to whichever paints. */
  className?: string
  /** The extreme-aspect swap's anchor, when this picture is inside one. */
  elementRef?: (element: HTMLElement | null) => void
  /** The loading-spinner state, where the card shows no hover at all. */
  disabled?: boolean
  /** The badge's progress, published upward — see the hosts' own state. */
  onFeedback: (feedback: PreviewFeedback | null) => void
  /**
   * WHERE THE POINTER HAS TO REST for this cell to preview (T1). `"card"` is
   * the trigger that shipped first and the default here, so a surface that
   * knows nothing about the setting keeps that behaviour byte for byte.
   *
   * Under `"button"` this picture arms NOTHING of its own: the badge is the
   * target, its arm lives one level up in the card (the badge and the picture
   * are siblings), and what reaches here is the answer — see `armPhase`.
   */
  trigger?: HoverPreviewTrigger
  /**
   * THE BADGE COUNTDOWN'S PHASE, from the card's `usePreviewTriggerArm`. Two
   * of its four values matter here and they are different questions:
   * `"started"` mounts the preview (the same mount the card arm produces —
   * same ladder, same requests, same job), and `"counting"` shows the single
   * frame, which is what makes the swap the first feedback that a preview is
   * coming (T7). Always `"idle"` under the `"card"` trigger.
   */
  armPhase?: CountdownPhase
}) {
  // IS THERE ANYTHING LEFT TO TRY? The plan's ladder minus what this item has
  // already failed — the same subtraction the arm itself makes at its mount
  // (`PreviewArm`), asked here only to decide whether the hover arms at all.
  // Cheap: a Map lookup and a filter over at most three strings, on video
  // cells with previews on and nowhere else.
  const armable =
    !disabled &&
    previewArmLadder(picture.rungs, previewRungFailures(sha256)).length > 0
  // ONE TRIGGER OWNS THE GESTURE (T2/T3). Under `"button"` this hook is handed
  // `false` and binds nothing at all: the card-wide arm is not merely ignored,
  // it does not exist, so a cell in that mode carries two fewer listeners and
  // cannot arm from a rest anywhere but the badge.
  const hover = useArmedHover(armable && trigger === "card")
  const started = trigger === "card"
    ? hover.active
    : armable && armPhase === "started"
  // The anchor for BOTH the arming and the frame swap's `closest` lookup.
  const baseRef = useRef<HTMLElement | null>(null)
  const attach = useCallback((element: HTMLElement | null) => {
    baseRef.current = element
    hover.attach(element)
    elementRef?.(element)
  }, [hover.attach, elementRef])
  // ONLY A LARGE CELL SWAPS. The plan hands the same URL twice for a small one
  // (V12: it never shows the 2x2 while previews are on), so this one
  // comparison is what keeps the second layer, its two listeners and its three
  // state slots out of the small cells entirely — which is where a screenful
  // holds thirty of them.
  const swaps = picture.frame !== picture.poster
  const [hovered, setHovered] = useState(false)
  const [requested, setRequested] = useState(false)
  const [frameLoaded, setFrameLoaded] = useState(false)
  // WHEN THE SINGLE FRAME IS WANTED, as one pure rule over the trigger, the
  // cell's size and the countdown's phase (lib/previewCountdown.ts). Under
  // `"card"` it is plain `:hover`, as it has always been; under `"button"` the
  // card hover is left alone — the 2x2 zooms out like any image card, with the
  // badge on it — and the swap lands when the badge arm fires.
  const frameWanted = previewFrameShown({
    trigger,
    swaps,
    cardHovered: hovered,
    phase: armPhase,
  })
  useEffect(() => {
    // The `"card"` trigger's own listeners, which the `"button"` one does not
    // need: there the swap follows the countdown, and the pointer's presence
    // on the card is the stylesheet's business alone.
    if (disabled || !swaps || trigger !== "card") return
    // The group root, not this <img>: the corner buttons sit over the picture,
    // and the swap must track the stylesheet's hover region — see
    // ExtremeAspectPicture in components/SearchResultImage.tsx for the full
    // reasoning, and for why mouseenter rather than pointerenter.
    const root = baseRef.current?.closest(`[${CELL_HOVER_ROOT_ATTR}]`)
    if (!root) return
    const enter = () => {
      setHovered(true)
      setRequested(true)
    }
    const leave = () => setHovered(false)
    root.addEventListener("mouseenter", enter)
    root.addEventListener("mouseleave", leave)
    return () => {
      root.removeEventListener("mouseenter", enter)
      root.removeEventListener("mouseleave", leave)
    }
  }, [disabled, swaps, trigger])
  // THE `"button"` TRIGGER'S HALF OF THE SAME LATCH. The card path sets both
  // flags in one handler (one commit for the whole hover); here the request is
  // the arm's consequence, so it is latched from the answer instead. A no-op
  // on every other render, and never reached under the `"card"` trigger.
  useEffect(() => {
    if (trigger !== "card" && frameWanted) setRequested(true)
  }, [trigger, frameWanted])
  // LATCH-UNTIL-LOADED, VideoStillPicture's rule in reverse: the mosaic keeps
  // painting until the single frame has fired its own `load`, so a slow
  // response shows the picture the cell already had rather than an empty box.
  const showFrame = frameWanted && frameLoaded
  // The colour rung rides the element's own inline style and is cleared on
  // `load`; every other rung is a PNG data URL handed to `placeholder`
  // DIRECTLY (`placeholder="blur"` is forbidden here as everywhere else in a
  // virtualized grid). Both halves are `CellStillImage`'s verbatim — see the
  // settled law there for the measurements behind each.
  const colour = isPlaceholderColour(placeholder)
  return (
    <>
      <Image
        ref={attach}
        src={picture.poster}
        alt={alt}
        fill
        placeholder={colour ? "empty" : (placeholder ?? "empty")}
        style={colour ? { backgroundColor: placeholder } : undefined}
        // ONLY at the colour rung, so no other tier pays for a listener it
        // would never use — see CellStillImage.
        onLoad={colour ? clearPlaceholderColour : undefined}
        unoptimized
        className={cn(
          (requested || showFrame) && "transition-opacity duration-150",
          showFrame ? "opacity-0" : "opacity-100",
          className)}
      />
      {swaps && requested && (
        <Image
          src={picture.frame}
          alt={alt}
          fill
          // NO placeholder: the mosaic underneath is it.
          className={cn("transition-opacity duration-150",
            showFrame ? "opacity-100" : "opacity-0",
            className)}
          // The layer must never eat the anchor's clicks or the card's drag —
          // it exists to be looked at.
          style={{ pointerEvents: "none" }}
          onLoad={() => setFrameLoaded(true)}
          unoptimized
        />
      )}
      {started && (
        <PreviewArm
          picture={picture}
          sha256={sha256}
          indexDb={indexDb}
          userDataDb={userDataDb}
          duration={duration}
          contentEndMs={contentEndMs}
          outroSkip={outroSkip}
          alt={alt}
          className={className}
          onFeedback={onFeedback}
        />
      )}
    </>
  )
}

/**
 * ONE ARM'S WALK DOWN THE LADDER.
 *
 * ITS LIFETIME IS THE ARM, and that is the whole reason it is a component
 * rather than a few more `useState`s in the picture above: the ladder it walks
 * is SNAPSHOT in its mount and cannot be moved afterwards. The host re-plans
 * on any render — one lands milliseconds after a failure, because publishing
 * the badge's progress sets host state — and its plan already subtracts the
 * session map, so a walker reading the live prop while advancing its own index
 * would subtract the same failure twice and land one rung PAST its fallback
 * (verifier round 2, §4: a two-rung ladder fell off the end and the cell never
 * previewed again; a three-rung one skipped the middle rung after creating and
 * cancelling a real job for it). `previewArmLadder` carries the rule.
 *
 * A failure is still recorded the moment it happens, and still with session
 * scope — it simply reaches the NEXT arm rather than this one, which is what
 * "never retry a failed rung" always meant.
 */
function PreviewArm({
  picture,
  sha256,
  indexDb,
  userDataDb,
  duration,
  contentEndMs,
  outroSkip,
  alt,
  className,
  onFeedback,
}: {
  picture: CellVideoPicture
  sha256: string
  indexDb: string | null
  userDataDb: string | null
  duration?: number | null
  contentEndMs?: number | null
  outroSkip: boolean
  alt: string
  className?: string
  onFeedback: (feedback: PreviewFeedback | null) => void
}) {
  // WHERE THE OUTRO CUTS THIS ITEM, or null when it does not govern — the
  // preference off, no boundary on the row, or a boundary the server would
  // refuse (lib/videoPreview.ts `previewOutroCut`). One pure call on row
  // fields, shared by the two kinds of layer below: the job rungs send it as
  // the named cut, the direct rung enforces it on its own element.
  const outroCutSec = previewOutroCut(
    { content_end_ms: contentEndMs, duration },
    outroSkip
  )
  // THE SNAPSHOT, taken once at mount by a lazy initializer — the idiomatic
  // "freeze a prop for this instance". Re-derived from the session map rather
  // than trusted from the plan, because the plan may be a render old and a
  // failure the previous arm recorded has to reach this one.
  const [ladder] = useState(() =>
    previewArmLadder(picture.rungs, previewRungFailures(sha256)))
  // HOW FAR DOWN IT THIS ARM HAS WALKED. Off the end is `"none"`: nothing
  // mounts, and the frame the cell was already showing stays — the correct
  // picture, and the one every other failure on these cards lands on.
  const [step, setStep] = useState(0)
  const rung = rungAtStep(ladder, step)
  /**
   * HAS THIS ARM LET GO? A ref rather than state, and both halves of that are
   * load-bearing: it is read from an event handler that can fire after the
   * element is already gone, and flipping it must re-render nothing.
   *
   * Written by the `<video>`'s OWN ref, which is the only place that can know
   * the answer at the right moment: `LoopVideo`'s cleanup calls `elementRef`
   * with null BEFORE it runs `abortVideo` (see the ref there), so by the time
   * the abort's `load()` could queue an `error` this is already true.
   */
  const released = useRef(false)
  const attachPreviewVideo = useCallback((element: HTMLElement | null) => {
    released.current = element === null
  }, [])
  const failRung = () => {
    notePreviewRungFailure(sha256, rung)
    setStep((current) => current + 1)
  }
  /**
   * The same fall, from an ELEMENT error rather than a job's verdict — and
   * therefore guarded (`shouldRecordFailure`, which is where the reasoning
   * lives). A teardown's `error` must neither demote the item for the session
   * nor step this arm down the ladder.
   *
   * The job path deliberately does NOT go through here: a `failed` job is the
   * server's verdict, it arrives while this arm is mounted and watching, and
   * between one rung's element unmounting and the next one's mounting there is
   * a window in which `released` is legitimately true.
   */
  const failRungFromElement = () => {
    if (!shouldRecordFailure({ released: released.current, rung })) return
    failRung()
  }
  if (rung === "direct" && picture.directSrc) {
    // THE DIRECT RUNG: the item's OWN file, whole, which this browser can
    // decode and which the server's cap has already said is small enough to
    // be worth pulling. `LoopVideo` is `preload="none"` with no autoplay, so
    // the request starts with the director's `play()` — but a media element
    // buffers ahead as fast as the link allows once it does, which is why the
    // cap and not the element is what bounds this.
    return (
      <PreviewCutVideo
        src={picture.directSrc}
        poster={picture.frame}
        alt={alt}
        className={className}
        elementRef={attachPreviewVideo}
        onFailed={failRungFromElement}
        cutSec={outroCutSec}
        // The ORIGINAL: its metadata is what the index measured, so the
        // element's own duration can refine the cut the way the player's does.
        refine={{ contentEndMs, duration }}
      />
    )
  }
  if (rung === "trim" || rung === "transcode") {
    // BOTH JOB RUNGS THROUGH ONE PATH. A stream copy and a re-encode differ
    // only in the preset they name: same store, same key shape, same
    // cancel-and-joined rules, same badge ring — the copy is simply fast
    // enough that the ring barely shows.
    //
    // KEYED ON THE RUNG so that falling from `trim` to `transcode` REMOUNTS
    // this layer: its whole mechanism is its lifetime (see its doc), and a
    // preset change under a mounted one would leave the first job's slot
    // claimed and its effect keyed on the old value.
    return (
      <PreviewTranscodeLayer
        key={rung}
        rung={rung}
        sha256={sha256}
        indexDb={indexDb}
        userDataDb={userDataDb}
        duration={duration}
        contentEndMs={contentEndMs}
        outroCutSec={outroCutSec}
        poster={picture.frame}
        alt={alt}
        className={className}
        onFeedback={onFeedback}
        onJobFailed={failRung}
        onArtifactFailed={failRungFromElement}
        elementRef={attachPreviewVideo}
      />
    )
  }
  return null
}

/**
 * A PREVIEW ELEMENT THAT LOOPS AT THE OUTRO CUT in the browser, when one
 * governs — the direct rung's original, and the copy rung's artifact.
 *
 * THE GALLERY PLAYER'S OWN MECHANISM, not a second one: `useVideoTrim` in
 * loop mode watches the playhead and seeks back to the start when it crosses
 * the end bound. What the bound is depends on what is playing:
 *
 *   - the ORIGINAL (`refine` given): `outroCutPoint` fed the row's boundary,
 *     its indexed duration and this element's own — the midpoint anchoring
 *     the player uses, within about a tenth of a second of the card. Good
 *     enough for a muted thumbnail; the player's frame-exact refinement is
 *     deliberately NOT asked for: the rVFC end probe mounts a second,
 *     offscreen `<video>` and seeks it to the END of the file, i.e. a second
 *     Range request of the file's tail on every hover — the very traffic the
 *     byte cap exists to bound;
 *   - the STREAM COPY (`refine` absent): the plan's own start-anchored
 *     `cutSec`, unrefined. The server already ended the artifact at the cut,
 *     but a packet copy cannot end on the frame: MEASURED, ffmpeg's
 *     output-side `-t` on a B-frame source kept two frames past the bound
 *     (241 frames / 8.03 s for `-t 7.94` at 30 fps — reordering, not the
 *     GOP), which is a frame or two of end card at every loop seam. The
 *     copy's raw packet timestamps are the source's, but it is written with
 *     `-avoid_negative_ts make_zero` and its edit list no longer compensates
 *     the B-frame CTS offset, so on an engine that honours edit lists its
 *     frames PRESENT about one reorder delay LATER than the source's (~66 ms
 *     at 30 fps with three B-frames). The client's cut therefore fires that
 *     much EARLY — into content, never into the card — which is the safe
 *     direction, and why the unrefined start-anchored cut is acceptable
 *     here. The element's own duration is no anchor — it is the artifact's,
 *     not the file's, and `outroCutPoint` would rightly read the
 *     disagreement as two files.
 *
 * The re-encode rung needs none of this: a decoded stream is cut on the
 * frame, so its artifact simply ends where the cut is and native loop wraps.
 * It passes `cutSec` null and this binds nothing.
 *
 * The native `loop` attribute STAYS ON (LoopVideo's). The crossing check
 * seeks before the natural end is ever reached, and when the cut does not
 * apply — the original's duration disagrees with the index by a second or
 * more, say, or a copy of a long item whose cut lies past the 16 s window —
 * native loop wraps at zero, which is the start anyway. Nothing here can make
 * the preview stop.
 *
 * ONLY THE PREVIEWING CELL PAYS: this component, its duration listener and
 * its playhead check exist for the one element the pointer has armed, and
 * for no other card on the surface.
 */
function PreviewCutVideo({
  src,
  poster,
  alt,
  className,
  elementRef,
  onFailed,
  cutSec,
  refine,
}: {
  src: string
  poster: string
  alt: string
  className?: string
  /** The released flag's writer — see the caller. */
  elementRef: (element: HTMLElement | null) => void
  /** The element would not decode. Guarded by the caller. */
  onFailed: () => void
  /** `previewOutroCut`'s verdict: null means the cut does not govern. */
  cutSec: number | null
  /**
   * Refine the cut against this element's own duration — only when the
   * element plays the ORIGINAL file, whose metadata the row describes.
   */
  refine?: { contentEndMs?: number | null; duration?: number | null }
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const attach = useCallback(
    (element: HTMLElement | null) => {
      videoRef.current = element as HTMLVideoElement | null
      elementRef(element)
    },
    [elementRef]
  )
  const governs = cutSec != null
  // The element's own duration, once its metadata loads — the second anchor
  // of the midpoint cut. NaN until then, which `outroCutPoint` reads as
  // "unusable" and answers with the start-anchored cut, so the bound exists
  // from the first frame and merely refines when the metadata arrives.
  // Subscribed only when there is something to refine against.
  const browserDuration = useVideoDuration(videoRef, governs && !!refine)
  const cut = !governs
    ? null
    : refine
      ? outroCutPoint(refine.contentEndMs, refine.duration, browserDuration)
      : cutSec
  useVideoTrim({
    videoRef,
    trim: cut == null ? null : { start: null, end: cut },
    active: governs,
  })
  return (
    <LoopVideo
      src={src}
      poster={poster}
      alt={alt}
      // NO placeholder: the frame underneath is it, and a blur (or a flat
      // colour) behind a layer fading in over a painted picture is the
      // flash the fade exists to avoid.
      placeholder={undefined}
      className={className}
      elementRef={attach}
      fadeIn
      registered
      onFailed={onFailed}
    />
  )
}

/**
 * THE TWO JOB RUNGS, mounted only while this cell is the previewing one
 * (V3/V4/V11).
 *
 * ITS LIFETIME IS THE WHOLE MECHANISM. Mounting submits (or joins) the preview
 * job and claims the single client-wide preview slot; unmounting gives the
 * slot back, which cancels the job when this client created it and leaves it
 * alone when it joined somebody else's. So a skim across ten needs-transcode
 * cells leaves at most one live encode behind it, without any cell knowing
 * about any other.
 *
 * IT IS ALSO THE ONLY SUBSCRIBER. `useTranscodeKeyState` lives in here rather
 * than in the card, so the job's queue position and progress re-render exactly
 * one component on the surface — the invariant the whole package rests on is
 * that an un-hovered cell subscribes to nothing, and a previewing cell must
 * not make its neighbours pay either.
 */
function PreviewTranscodeLayer({
  rung,
  sha256,
  indexDb,
  userDataDb,
  duration,
  contentEndMs,
  outroCutSec,
  poster,
  alt,
  className,
  onFeedback,
  onJobFailed,
  onArtifactFailed,
  elementRef,
}: {
  /** Which preset to ask for: the stream copy, or the re-encode. */
  rung: PreviewJobRung
  sha256: string
  indexDb: string | null
  userDataDb: string | null
  duration?: number | null
  /**
   * The row's `content_end_ms`, for the KEY only (`previewKey`): the slot is
   * named after the boundary so a boundary that moves in-session lands on a
   * fresh slot instead of replaying the old artifact. The wire still names
   * the cut as `"outro"` and lets the server resolve it.
   */
  contentEndMs?: number | null
  /** `previewOutroCut`'s verdict: non-null names the cut in the request. */
  outroCutSec: number | null
  poster: string
  alt: string
  className?: string
  onFeedback: (feedback: PreviewFeedback | null) => void
  /** The JOB refused. Always evidence — see the caller's two callbacks. */
  onJobFailed: () => void
  /** The finished artifact would not PLAY. Guarded by the caller. */
  onArtifactFailed: () => void
  /** The released flag's writer — see the caller. */
  elementRef: (element: HTMLElement | null) => void
}) {
  // The 16 s cap, the named outro cut, and the key they produce. All pure
  // functions of the row (lib/videoPreview.ts), so the key is a value this
  // component holds rather than something it has to be told.
  const request = previewRequest({ duration }, rung, outroCutSec)
  const key = previewKey(sha256, request, contentEndMs)
  useEffect(() => {
    startPreviewTranscode({
      sha256,
      dbs: { index_db: indexDb, user_data_db: userDataDb },
      request,
      contentEndMs,
    })
    // THE CANCEL (V4). Guarded on identity inside — by the time this runs, the
    // slot may already belong to the cell the pointer moved to.
    return () => releasePreviewTranscode(key)
    // Keyed on the KEY and the two database names, which between them are
    // everything that decides WHICH encode this is and who answers for it.
    // `request` is a fresh object every render and is deliberately not a
    // dependency: the key already carries the only field of it that can change
    // the answer.
  }, [key, sha256, indexDb, userDataDb])
  const state = useTranscodeKeyState(key)
  const feedback = previewFeedback(state)
  const progress = feedback?.progress ?? null
  const caption = feedback?.caption ?? null
  // Published as PRIMITIVES so this effect fires when the ANSWER changes and
  // not when an object identity does — one badge update per queue move or
  // progress sample, rather than one per render of this component.
  useEffect(() => {
    onFeedback(progress == null ? null : { progress, caption: caption ?? "" })
  }, [progress, caption, onFeedback])
  // The leave clear, separate from the publish above so it runs on unmount
  // only: the badge goes back to its ordinary self the moment the pointer
  // leaves, whatever the job then does.
  useEffect(() => () => onFeedback(null), [onFeedback])
  // THE JOB'S OWN VERDICT IS A RUNG FAILURE. `failed` is sticky — the server
  // negative-caches it — so there is nothing to wait for and nothing to retry
  // at this preset; what there may be is a rung below (a refused mux falls to
  // the re-encode). The card records it either way, so a remount starts where
  // this one left off rather than repeating the refusal.
  const jobFailed = state.state === "failed"
  useEffect(() => {
    if (jobFailed) onJobFailed()
  }, [jobFailed, onJobFailed])
  if (state.state !== "done") return null
  return (
    <PreviewCutVideo
      src={state.artifactUrl}
      poster={poster}
      alt={alt}
      className={className}
      elementRef={elementRef}
      onFailed={onArtifactFailed}
      // The copy can run a frame or two past the cut (see the layer); the
      // re-encode cannot, and passes no cut at all.
      cutSec={rung === "trim" ? outroCutSec : null}
    />
  )
}
