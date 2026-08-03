'use client'

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

// Shared hover preview for pinboard thumbnails (library cards, history
// rows): a pointer-events-none image portaled to <body>. The portal matters:
// callers live inside transformed containers (the translate-centered dialog),
// where position:fixed would resolve against the transform, not the viewport.
//
// Callers pass no `maxw`: the popover is the largest consumer there is, and
// the displayed size is computed from the board's stored preview_w/preview_h
// against the viewport (see the box helpers below), never from the request
// width. Asking for a specific width only bought a JPEG re-encode of an
// already-lossy WebP master; the endpoint serves the stored bytes instead.
//
// The accepted cost: the master is 2048px wide while the popover is capped
// at half the viewport, so a hover usually pulls on the order of 4× the
// pixels it draws — a few hundred KB per board over the wire, which matters
// on a LAN-served gateway in a way it does not on localhost. Kept anyway,
// because the alternative reinstates the second lossy pass on every hover
// for the one image whose entire job is to be looked at closely, and
// because previews are served immutable: the download is once per board per
// browser cache, not once per hover.

const MARGIN = 8 // minimum gap to the viewport edges
const GAP = 8 // gap between the popover and its anchor

export type PopoverBox = {
    top: number
    left: number
    width: number
    height: number
}

const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), Math.max(lo, hi))

function fit(previewW: number, previewH: number, maxW: number, maxH: number) {
    const scale = Math.min(
        maxW / Math.max(1, previewW),
        maxH / Math.max(1, previewH)
    )
    return { width: previewW * scale, height: previewH * scale }
}

// Above or below the anchor, horizontally centered on it. Anchors above by
// default; flips below only when above is too cramped to be useful (less
// than ~a third of the viewport) and below actually offers more room.
// Library cards use this.
export function verticalPopoverBox(
    anchor: DOMRect,
    previewW: number,
    previewH: number
): PopoverBox {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceAbove = anchor.top - GAP - MARGIN
    const spaceBelow = vh - anchor.bottom - GAP - MARGIN
    const below = spaceAbove < vh * 0.35 && spaceBelow > spaceAbove
    const { width, height } = fit(
        previewW,
        previewH,
        vw * 0.5,
        Math.max(96, below ? spaceBelow : spaceAbove)
    )
    const left = clamp(
        anchor.left + anchor.width / 2 - width / 2,
        MARGIN,
        vw - width - MARGIN
    )
    const top = below ? anchor.bottom + GAP : anchor.top - GAP - height
    return { top: clamp(top, MARGIN, vh - height - MARGIN), left, width, height }
}

// Beside `panel` — whichever side of the viewport has more room — vertically
// centered on `row`. History rows use this so the popover never covers the
// panel itself.
export function horizontalPopoverBox(
    panel: DOMRect,
    row: DOMRect,
    previewW: number,
    previewH: number
): PopoverBox {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceLeft = panel.left - GAP - MARGIN
    const spaceRight = vw - panel.right - GAP - MARGIN
    const onRight = spaceRight > spaceLeft
    const { width, height } = fit(
        previewW,
        previewH,
        Math.min(vw * 0.5, Math.max(96, onRight ? spaceRight : spaceLeft)),
        vh - 2 * MARGIN
    )
    const left = onRight ? panel.right + GAP : panel.left - GAP - width
    const top = clamp(
        row.top + row.height / 2 - height / 2,
        MARGIN,
        vh - height - MARGIN
    )
    return { top, left: clamp(left, MARGIN, vw - width - MARGIN), width, height }
}

// Debounced hover state: opening waits `delayMs` so sweeping the pointer
// across a grid doesn't flash a popover per card, closing is immediate.
export function useDelayedHover<T>(
    delayMs = 200
): [T | null, (value: T | null) => void] {
    const [value, setValue] = useState<T | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const set = useCallback(
        (next: T | null) => {
            if (timer.current) {
                clearTimeout(timer.current)
                timer.current = null
            }
            if (next === null) setValue(null)
            else timer.current = setTimeout(() => setValue(next), delayMs)
        },
        [delayMs]
    )
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
        },
        []
    )
    return [value, set]
}

export function PreviewPopover({ src, box }: { src: string; box: PopoverBox }) {
    return createPortal(
        <div className="pointer-events-none fixed z-70" style={box}>
            <img
                src={src}
                alt=""
                draggable={false}
                className="h-full w-full rounded-md border bg-background object-contain shadow-xl"
            />
        </div>,
        document.body
    )
}
