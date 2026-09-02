"use client"

import { useState } from "react"
import { abortVideoOnDetach } from "@/components/LoopVideo"

/**
 * THE GALLERY LARGE VIEW'S ANIMATED PICTURE: an item big enough that its
 * DISPLAY request answers `video/mp4` rather than image bytes
 * (docs/thumbnail-format-implementation.md R3), plus the ladder it walks down
 * when that turns out not to be true.
 *
 * Its own component so the two rungs of state belong to the picture rather than
 * to the panel around it, and — the reason it is worth a file — so REACT'S KEY
 * can reset them. The host renders `<DisplayLoopPicture key={item.sha256} …/>`,
 * and every navigation therefore gets a fresh element with a fresh ladder. The
 * host itself is NOT keyed by item at either of its two mounts
 * (app/search/PreviewSurface.tsx and the gallery page both render one
 * long-lived GalleryImageLarge and change its `item`), so the state used to
 * need an explicit sha guard cleared during render; a key is the same rule
 * expressed where React already enforces it.
 *
 * THE LADDER, walked on ANY error with no error code read at all:
 *
 *   1. the `<video>` at the bare display URL;
 *   2. an `<img>` at THAT SAME URL;
 *   3. an `<img>` at the same request with `still=true`.
 *
 * Rung 2 comes first because of the keep-the-original SENTINEL — an item over
 * the bounds whose H.264 encode came out no smaller than its source, which the
 * endpoint answers at the bare URL with the ORIGINAL FILE, an animated GIF or
 * WebP that moves natively in an `<img>` at full size. `still=true` on such an
 * item does NOT answer that file: above the raw floor it answers the stored
 * ≤1024 grid-m POSTER, so landing there directly would downgrade the app's
 * largest surface from the animating original to a static thumbnail. The
 * `<img>` costs nothing extra either — the bytes are the ones the `<video>`
 * already asked for, so a sentinel item hits the browser cache.
 *
 * Rung 3 exists because rung 2 can fail too, for a reason no client-side test
 * predicts: a Chromium build with no H.264 decoder rejects a real loop, and the
 * bare URL then hands that `<img>` the mp4's bytes. `still=true` at the display
 * size is the one request the endpoint guarantees answers an image (§5), so the
 * ladder terminates there.
 *
 * NO ERROR CODE IS READ, deliberately. The split this replaces treated
 * MEDIA_ERR_SRC_NOT_SUPPORTED as "the sentinel" — one saved request in that
 * case, and a broken picture on the no-H.264 Chromium, where code 4 also covers
 * "this is not media I can play" and "the fetch failed".
 */
export function DisplayLoopPicture({
    loopSrc,
    stillSrc,
    alt,
    onDragStart,
    renderStill,
}: {
    /** The bare display URL: `video/mp4` for this item, and rung 2's `<img>`. */
    loopSrc: string
    /** The same request with `still=true` — rung 3, guaranteed an image. */
    stillSrc: string
    alt: string
    onDragStart: (event: React.DragEvent<HTMLElement>) => void
    /**
     * The host's own still `<img>`, so the two rungs below are the SAME element
     * the non-animated path renders — same classes, same `fill`, and the same
     * ref/onLoad pair that reports the painted aspect. That bookkeeping stays
     * in the host because it writes host state; this component only decides
     * WHICH URL it is pointed at and when.
     */
    renderStill: (src: string, onError?: () => void) => React.ReactNode
}) {
    // 0 = the `<video>`. One-way: an element that has errored must not be
    // re-mounted on the next render into the same error, and the key above is
    // what makes "within this item" the right scope for that.
    const [rung, setRung] = useState<0 | 1 | 2>(0)
    if (rung === 1) {
        return renderStill(loopSrc, () => setRung(2))
    }
    if (rung === 2) {
        // The last rung: a plain picture, with nowhere left to fall.
        return renderStill(stillSrc)
    }
    return (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <video
            src={loopSrc}
            // The still URL of the same rendition, so the first frame paints
            // while the loop's bytes are still arriving. It is the peek layer's
            // URL character for character, so the two surfaces fetch this
            // picture once between them.
            poster={stillSrc}
            // AUTOPLAY, unlike the grid's LoopVideo: there is no playback
            // director here and nothing to schedule. The gallery shows ONE
            // item, the user asked for it, and an animated picture that needs a
            // press to move is not the picture the `<img>` used to be.
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            // A <video> has no implicit ARIA role, so without this a screen
            // reader announces nothing where the <img> it stands in for
            // announces its `alt`. This is a picture that happens to move: no
            // controls, no sound, no timeline the user can reach.
            role="img"
            aria-label={alt}
            draggable={true}
            onDragStart={onDragStart}
            // Belt to the key's braces. React removes the element on
            // navigation, but a detached media element goes on FETCHING until
            // it is collected, and the gallery is arrow-keyed — a fast sweep
            // would leave a trail of them downloading. A ref CLEANUP (React 19)
            // runs at exactly the moment the element leaves, and it ABORTS
            // rather than merely pausing (see abortVideoOnDetach).
            ref={abortVideoOnDetach}
            // The element is the only thing that can tell us this URL is not a
            // loop after all, and the answer is the next rung down. Recording
            // it makes this idempotent: rung 1 renders an <img> instead of this
            // element, so the handler cannot fire twice.
            onError={() => setRung(1)}
            // What next/image's `fill` writes as inline style, plus the
            // `<img>`'s own object-fit: the two elements must occupy the same
            // box.
            className="absolute inset-0 h-full w-full object-contain"
            // Reports NO aspect, deliberately, and this is the rule the gallery
            // already follows for the player's element (see onMediaAspect): a
            // host box is a LAYOUT, and re-fitting it when a live element
            // reports metadata re-lays-out everything anchored to it. The cost
            // here is nil — a host falls back to item.width/height, which for
            // an animated image ARE the display dimensions (no EXIF rotation
            // exists in GIF/WebP animation, and the scan stores rotated
            // dimensions anyway).
        />
    )
}
