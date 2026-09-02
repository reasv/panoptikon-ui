"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { PlaceholderDataURL } from "@/lib/state/blurHashDataURL"
import { observeAnimatedCell } from "@/lib/state/animatedPlayback"

/**
 * What next/image's `fill` writes as inline style, spelled as classes for the
 * one picture element that is not a next/image: the loop's `<video>`. It has to
 * occupy the card's picture box exactly as the `<img>` it stands in for does,
 * or the two cell kinds would not be interchangeable on screen.
 */
export const FILL_CLASSES = "absolute inset-0 h-full w-full"

/**
 * A ref that does nothing on attach and TEARS THE ELEMENT DOWN on detach (a
 * React 19 ref cleanup), so whatever removes the element stops both its
 * playback and its FETCH at exactly that moment rather than whenever a detached
 * media element happens to be collected.
 *
 * `pause()` ALONE IS NOT ENOUGH. Pausing stops playback and nothing else: the
 * resource selection algorithm goes on buffering the rest of the loop into a
 * detached element. In an arrow-keyed gallery that is a trail of multi-megabyte
 * downloads for pictures nobody is looking at any more; in a hover-mode grid it
 * is the loop of every cell the pointer has rested on, still arriving after the
 * pointer left. Clearing `src` and calling `load()` is what the spec defines as
 * ABORTING: it runs the media load algorithm on an empty source, which fires
 * `emptied`, drops the current resource and cancels the fetch. Both, in that
 * order, because `load()` on its own resets a still-set `src` and starts
 * fetching again.
 *
 * Module scope, so its identity is stable and React never detaches and
 * reattaches it on a re-render. Read this before inlining it.
 */
export function abortVideo(el: HTMLVideoElement | null): void {
    if (!el) return
    el.pause()
    el.removeAttribute("src")
    el.load()
}

/** The same thing shaped as a ref: nothing on attach, the abort on detach. */
export const abortVideoOnDetach = (el: HTMLVideoElement | null) => () => abortVideo(el)

/**
 * THE animated-loop element, spelled once for every surface that shows one:
 * the grid card in either animate mode, and the gallery filmstrip's
 * hover-played cards. Its own module because those live in different trees and
 * the contract below — what plays it, what fetches it, what happens when the
 * response turns out not to be a video — has to be the same wherever it
 * appears.
 *
 * Styled to be INDISTINGUISHABLE from the `<img>` it stands in for: the caller
 * hands down the card's own object-fit classes verbatim, and `FILL_CLASSES`
 * reproduces what next/image's `fill` writes as inline style.
 * `object-fit`/`object-position` apply to a replaced element whatever its
 * kind, so the CSS hover-contain and the rounded corners work here untouched.
 *
 * NOTHING IS FETCHED UNTIL IT IS PLAYED. `preload="none"` and no `autoplay`:
 * the loop's bytes are requested by the director's own `play()`, and the
 * director only plays cells that are at least half on screen and inside the
 * cap. An earlier build carried `autoplay` and let the element decide, which
 * fetched and fully buffered EVERY mounted loop — measured at 16/16 buffered
 * with 14 of them off screen, ~4 MB nobody saw. The poster paints immediately
 * and the blurhash sits behind it, so a cell that has not been played yet is a
 * still picture rather than an empty box.
 *
 * KNOWN, ACCEPTED UX DELTA: right-clicking an animated cell gets the browser's
 * VIDEO context menu (Loop, Show controls, Save video as…) rather than the
 * image one. Inherent to being a real media element; flagged for user QA.
 */
export function LoopVideo({
    src,
    poster,
    alt,
    blurDataURL,
    className,
    elementRef,
    registered,
    fadeIn,
    onFailed,
}: {
    src: string
    poster: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    className?: string
    elementRef?: (element: HTMLElement | null) => void
    /** False while something covers this cell — see LoopPictureProps.occluded. */
    registered: boolean
    /**
     * Start transparent and fade in on the first DECODED frame. For a layer
     * over a poster: without it the element paints its own `poster` attribute
     * first, which is the same picture at a different moment — a visible blink
     * where there should be no transition at all.
     */
    fadeIn?: boolean
    /**
     * The response was not a video. THE POSTER FALLBACK IS THE POINT, not
     * defensive polish: two states answer a grid-tier request for an animated
     * item above the floor with the item's own IMAGE bytes, and the client
     * cannot tell either apart in advance —
     *
     *   - the backfill has not written the loop yet — transitional, and
     *     answered `no-cache` so it resolves the moment the scan lands;
     *   - no H.264 encode of this source came out smaller than the source, so
     *     the settled keep-the-original edge serves the file itself —
     *     PERMANENT, and answered immutable, so the fallback is the only thing
     *     that will ever render those items.
     *
     * A cell that only ever mounted `<video>` shows an empty box in both. The
     * swap hangs off the element's own `error` event — NO PROBE REQUEST, which
     * would double the request count for the common case to save one wasted
     * fetch in the rare one — and every caller latches it one-way, so a failure
     * cannot loop.
     */
    onFailed: () => void
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [live, setLive] = useState(false)
    // The concurrency policy in one line: the director owns the observer, the
    // scroll listener, the cap and every play/pause call, and this cell owns
    // nothing but its membership (lib/state/animatedPlayback.ts). Dropped on
    // the occlusion flag, which is what pauses a loop the hover layer has
    // covered — and, in hover mode, when the element unmounts on leave, which
    // is what D7's "pause + unmount" is made of.
    useEffect(() => {
        const video = videoRef.current
        if (!video || !registered) return
        return observeAnimatedCell(video)
    }, [registered])
    return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
            ref={(element) => {
                videoRef.current = element
                elementRef?.(element)
                // A React 19 ref CLEANUP, which also means this callback is no
                // longer invoked with `null` — so the two writes above are
                // undone here by hand, exactly as React used to do for them.
                return () => {
                    videoRef.current = null
                    elementRef?.(null)
                    // THE ABORT. In hover mode this element unmounts the moment
                    // the pointer leaves, and a detached media element keeps
                    // buffering the rest of the loop: the exact cost hover mode
                    // exists to avoid, paid on every cell the pointer rested on.
                    abortVideo(element)
                }
            }}
            src={src}
            // Shown until the director plays this cell and the first frame
            // decodes, and shown for good if the response turns out not to be a
            // video at all — so the cell paints a correct picture throughout.
            poster={poster}
            // A <video> has no implicit ARIA role, so a screen reader would
            // announce nothing here where the card it replaces announces its
            // `alt`. `role="img"` plus the label is that parity: this element
            // is a picture that happens to move, not a media player (it has no
            // controls, no sound and no timeline the user can reach).
            role="img"
            aria-label={alt}
            // `muted` is intrinsic rather than a setting: a grid of cells that
            // could make noise is not a grid, and it is also what keeps the
            // director's `play()` permissible without a user gesture in every
            // browser.
            muted
            loop
            playsInline
            disablePictureInPicture
            // NOT `autoplay`, and deliberately: see the note on this component.
            // The director decides what plays, and `preload="none"` is what
            // makes that decision cover the network too rather than only the
            // decode.
            preload="none"
            onError={onFailed}
            onPlaying={fadeIn ? () => setLive(true) : undefined}
            style={blurDataURL ? {
                backgroundImage: `url("${blurDataURL}")`,
                backgroundSize: "cover",
                backgroundPosition: "50% 0%",
                backgroundRepeat: "no-repeat",
            } : undefined}
            className={cn(FILL_CLASSES,
                fadeIn && cn("transition-opacity duration-150",
                    live ? "opacity-100" : "opacity-0"),
                className)}
        />
    )
}
