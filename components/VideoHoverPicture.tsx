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
  previewFeedback,
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
  // HOW FAR DOWN THE LADDER THIS MOUNT HAS WALKED. A rung that fails hands the
  // cell to the next one; walking off the end leaves `"none"`, which disarms
  // the hover and leaves the frame the cell was already showing — the correct
  // picture, and the one every other failure on these cards lands on.
  //
  // The step is LOCAL, while the failure itself is recorded in the session map
  // (`notePreviewRungFailure`): the local number is what re-renders this mount
  // onto the next rung, and the map is what stops the card handing the failed
  // rung back the next time this cell mounts.
  const [step, setStep] = useState(0)
  const rung = picture.rungs[step] ?? "none"
  const armable = !disabled && rung !== "none"
  const hover = useArmedHover(armable)
  const failRung = () => {
    notePreviewRungFailure(sha256, rung)
    setStep((current) => current + 1)
  }
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
      {hover.active && (rung === "direct" && picture.directSrc ? (
        // THE DIRECT RUNG: the item's OWN file, whole, which this browser can
        // decode and which the server's cap has already said is small enough
        // to be worth pulling. `LoopVideo` is `preload="none"` with no
        // autoplay, so the request starts with the director's `play()` — but
        // a media element buffers ahead as fast as the link allows once it
        // does, which is why the cap and not the element is what bounds this.
        <LoopVideo
          src={picture.directSrc}
          poster={picture.frame}
          alt={alt}
          // NO placeholder: the frame underneath is it, and a blur (or a flat
          // colour) behind a layer fading in over a painted picture is the
          // flash the fade exists to avoid.
          placeholder={undefined}
          className={className}
          fadeIn
          registered
          onFailed={failRung}
        />
      ) : rung === "trim" || rung === "transcode" ? (
        // BOTH JOB RUNGS THROUGH ONE PATH. A stream copy and a re-encode
        // differ only in the preset they name: same store, same key shape,
        // same cancel-and-joined rules, same badge ring — the copy is simply
        // fast enough that the ring barely shows.
        //
        // KEYED ON THE RUNG so that falling from `trim` to `transcode`
        // REMOUNTS this layer: its whole mechanism is its lifetime (see its
        // doc), and a preset change under a mounted one would leave the first
        // job's slot claimed and its effect keyed on the old value.
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
          onFailed={failRung}
        />
      ) : null)}
    </>
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
  poster,
  alt,
  className,
  onFeedback,
  onFailed,
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
  onFailed: () => void
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
    if (jobFailed) onFailed()
  }, [jobFailed, onFailed])
  if (state.state !== "done") return null
  return (
    <LoopVideo
      src={state.artifactUrl}
      poster={poster}
      alt={alt}
      // The frame underneath is the placeholder — see the rung-0 layer.
      placeholder={undefined}
      className={className}
      fadeIn
      registered
      onFailed={onFailed}
    />
  )
}
