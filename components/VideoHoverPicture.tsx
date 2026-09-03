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
 *      real dwell, not scroll-suspended) and fading in on its first decoded
 *      frame. NOTHING IS REQUESTED BEFORE THAT: no `<video>` element exists,
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
  alt,
  placeholder,
  className,
  elementRef,
  disabled,
  onFeedback,
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
}) {
  // IS THERE ANYTHING LEFT TO TRY? The plan's ladder minus what this item has
  // already failed — the same subtraction the arm itself makes at its mount
  // (`PreviewArm`), asked here only to decide whether the hover arms at all.
  // Cheap: a Map lookup and a filter over at most three strings, on video
  // cells with previews on and nowhere else.
  const armable =
    !disabled &&
    previewArmLadder(picture.rungs, previewRungFailures(sha256)).length > 0
  const hover = useArmedHover(armable)
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
  useEffect(() => {
    if (disabled || !swaps) return
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
  }, [disabled, swaps])
  // LATCH-UNTIL-LOADED, VideoStillPicture's rule in reverse: the mosaic keeps
  // painting until the single frame has fired its own `load`, so a slow
  // response shows the picture the cell already had rather than an empty box.
  const showFrame = swaps && hovered && frameLoaded
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
      {hover.active && (
        <PreviewArm
          picture={picture}
          sha256={sha256}
          indexDb={indexDb}
          userDataDb={userDataDb}
          duration={duration}
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
  alt,
  className,
  onFeedback,
}: {
  picture: CellVideoPicture
  sha256: string
  indexDb: string | null
  userDataDb: string | null
  duration?: number | null
  alt: string
  className?: string
  onFeedback: (feedback: PreviewFeedback | null) => void
}) {
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
      <LoopVideo
        src={picture.directSrc}
        poster={picture.frame}
        alt={alt}
        // NO placeholder: the frame underneath is it, and a blur (or a flat
        // colour) behind a layer fading in over a painted picture is the
        // flash the fade exists to avoid.
        placeholder={undefined}
        className={className}
        elementRef={attachPreviewVideo}
        fadeIn
        registered
        onFailed={failRungFromElement}
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
  // The 16 s cap, and the key it produces. Both are pure functions of the row
  // (lib/videoPreview.ts), so the key is a value this component holds rather
  // than something it has to be told.
  const request = previewRequest({ duration }, rung)
  const key = previewKey(sha256, request)
  useEffect(() => {
    startPreviewTranscode({
      sha256,
      dbs: { index_db: indexDb, user_data_db: userDataDb },
      request,
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
    <LoopVideo
      src={state.artifactUrl}
      poster={poster}
      alt={alt}
      // The frame underneath is the placeholder — see the rung-0 layer.
      placeholder={undefined}
      className={className}
      elementRef={elementRef}
      fadeIn
      registered
      onFailed={onArtifactFailed}
    />
  )
}
