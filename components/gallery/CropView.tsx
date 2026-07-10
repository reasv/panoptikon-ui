'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CropRect, FULL_CROP, MIN_CROP_FRAC, clampCrop } from '@/lib/pinboardCrop'

// Crop-mode model: the box (card interior) IS the window. The image is a
// free transform (uniform scale + offset) behind it; the crop committed at
// the end of each gesture is simply box ∩ image in image coordinates.
// At rest (crop mode off) the stored crop is contain-fitted as before.

interface Transform {
    scale: number
    // Image top-left relative to the container, px
    x: number
    y: number
}

interface Geometry {
    // All in container-local pixels.
    // vis* is the visible (cropped) region, img* the full media element.
    visL: number
    visT: number
    visW: number
    visH: number
    imgL: number
    imgT: number
    imgW: number
    imgH: number
}

// Fit the crop region into the container ("contain" semantics: the crop
// rect is treated as the source image, letterboxing on aspect mismatch)
function computeRestGeometry(
    W: number,
    H: number,
    c: CropRect,
    nw: number,
    nh: number,
): Geometry {
    const cropPxW = c.w * nw
    const cropPxH = c.h * nh
    const scale = Math.min(W / cropPxW, H / cropPxH)
    const visW = cropPxW * scale
    const visH = cropPxH * scale
    const visL = (W - visW) / 2
    const visT = (H - visH) / 2
    return {
        visL,
        visT,
        visW,
        visH,
        imgL: visL - c.x * nw * scale,
        imgT: visT - c.y * nh * scale,
        imgW: nw * scale,
        imgH: nh * scale,
    }
}

// Constrain the image between its two flush-against-the-window positions
// on each axis: when it covers the box that means no interior gaps; when
// it's smaller it can slide within the box but not leave it
function clampTransform(t: Transform, boxW: number, boxH: number, nw: number, nh: number): Transform {
    const w = nw * t.scale
    const h = nh * t.scale
    return {
        scale: t.scale,
        x: Math.min(Math.max(t.x, Math.min(0, boxW - w)), Math.max(0, boxW - w)),
        y: Math.min(Math.max(t.y, Math.min(0, boxH - h)), Math.max(0, boxH - h)),
    }
}

// Initial view for a stored crop: contain-fit it, centered — the exact
// same framing rest mode renders (computeRestGeometry), so toggling crop
// mode never changes what the user sees. The crop's aspect can differ
// from the box's (a box edge dragged past the image edge commits only
// box∩image — the dead space isn't representable — and plain rest-mode
// box resizes don't touch the crop at all); the honest display of that
// mismatch is the letterboxed contain fit, so unlike the interactive
// gestures this initial placement is NOT clamped: pan/zoom invariants
// (clampTransform) would pin the image flush against the window instead
// of centering the crop, silently showing a different region than rest
// mode. An earlier version also raised the scale until the crop filled
// the box on any cropped axis, which made every subsequent commit
// silently tighten the crop by the aspect mismatch.
function initTransform(boxW: number, boxH: number, nw: number, nh: number, crop: CropRect | null): Transform {
    const c = crop ?? FULL_CROP
    const cropW = c.w * nw
    const cropH = c.h * nh
    const scale = Math.min(boxW / cropW, boxH / cropH)
    return {
        scale,
        x: boxW / 2 - (c.x + c.w / 2) * nw * scale,
        y: boxH / 2 - (c.y + c.h / 2) * nh * scale,
    }
}

// The region of the image visible through the box, in image fractions
function transformToCrop(t: Transform, boxW: number, boxH: number, nw: number, nh: number): CropRect {
    const w = nw * t.scale
    const h = nh * t.scale
    const l = Math.max(0, -t.x)
    const tp = Math.max(0, -t.y)
    const r = Math.min(w, boxW - t.x)
    const b = Math.min(h, boxH - t.y)
    return clampCrop({ x: l / w, y: tp / h, w: (r - l) / w, h: (b - tp) / h })
}

function cropEq(a: CropRect | null, b: CropRect | null): boolean {
    if (!a || !b) return a === b
    const eps = 0.75 / 1295 // just under the serialization precision
    return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
        && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps
}

// The image's and the crop window's current extents in viewport pixels,
// for the grid layer to clamp crop-mode box resizes against
interface Rect {
    left: number
    top: number
    right: number
    bottom: number
}
export interface CropGeometry {
    image: Rect
    box: Rect
}

export function CropView({
    crop,
    cropMode,
    boxResizing,
    naturalWidth,
    naturalHeight,
    onCropChange,
    imageExtentRef,
    ghostSrc,
    renderMedia,
}: {
    crop: CropRect | null
    cropMode: boolean
    // True while the grid box is being resized via a handle in crop mode.
    // The image stays anchored in screen space so the box edges cut into
    // it (or move away from it, consuming/growing letterbox).
    boxResizing: boolean
    naturalWidth?: number | null
    naturalHeight?: number | null
    onCropChange: (crop: CropRect) => void
    // While in crop mode, receives a getter for the image's and the crop
    // window's viewport extents so the grid layer can stop box edges at
    // the image edges
    imageExtentRef?: React.MutableRefObject<(() => CropGeometry | null) | null>
    // Translucent full image shown beyond the box while cropping
    ghostSrc?: string
    renderMedia: (style: React.CSSProperties) => React.ReactNode
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null)
    const [transform, setTransform] = useState<Transform | null>(null)

    const nw = naturalWidth || 0
    const nh = naturalHeight || 0

    const transformRef = useRef<Transform | null>(null)
    transformRef.current = transform
    const cropModeRef = useRef(cropMode)
    cropModeRef.current = cropMode
    const boxResizingRef = useRef(boxResizing)
    boxResizingRef.current = boxResizing
    const onCropChangeRef = useRef(onCropChange)
    onCropChangeRef.current = onCropChange
    const lastCommittedRef = useRef<CropRect | null>(null)
    // Image position in viewport coordinates, frozen while the box resizes
    const anchorRef = useRef<{ left: number; top: number; scale: number } | null>(null)
    const lastSizeRef = useRef<{ w: number; h: number } | null>(null)
    const panStateRef = useRef<{ startX: number; startY: number; t: Transform } | null>(null)
    const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const commit = (c: CropRect) => {
        lastCommittedRef.current = c
        onCropChangeRef.current(c)
    }

    const applyTransform = (t: Transform) => {
        transformRef.current = t
        setTransform(t)
    }

    // Layout effect + an immediate measure so the first paint already has
    // the container size: waiting for the ResizeObserver's initial async
    // delivery paints at least one frame of the geometry-less fallback,
    // which for a cropped item is the full uncropped image.
    useLayoutEffect(() => {
        const el = containerRef.current
        if (!el) return
        const measure = () => {
            const rect = el.getBoundingClientRect()
            const size = { w: rect.width, h: rect.height }
            setContainerSize(size)
            const t = transformRef.current
            if (cropModeRef.current && t && nw && nh) {
                // The anchor can be missing while a handle-drag is in
                // progress: the transform wasn't initialized yet when the
                // boxResizing effect tried to capture it (image metadata or
                // the first size measurement arrived late), or the component
                // remounted mid-drag. Capture it now, from the image's
                // current viewport position — without this, the resize falls
                // into the re-fit branch below, which re-centers the image
                // on every step and eats BOTH sides of the resized axis.
                if (boxResizingRef.current && !anchorRef.current) {
                    anchorRef.current = { left: rect.left + t.x, top: rect.top + t.y, scale: t.scale }
                }
                const anchor = anchorRef.current
                if (anchor) {
                    // Box edges move around the screen-fixed image while the
                    // handle is held; the region in the window is the crop
                    // that will be committed on release
                    const anchored = {
                        scale: anchor.scale,
                        x: anchor.left - rect.left,
                        y: anchor.top - rect.top,
                    }
                    applyTransform(anchored)
                } else if (lastSizeRef.current &&
                    (Math.abs(size.w - lastSizeRef.current.w) > 1 || Math.abs(size.h - lastSizeRef.current.h) > 1)) {
                    // Box changed outside a handle drag (a menu resize, or
                    // RGL's post-release resize transition delivering one
                    // step per frame): re-fit the LAST COMMITTED crop to the
                    // new box. Reading the crop back from the current
                    // transform (transformToCrop) here would iterate the
                    // letterbox instead of preserving the view: contain-
                    // fitting a crop whose aspect differs from the box shows
                    // adjacent image content in the letterbox area, and
                    // box∩image reads that content back into the crop — so
                    // each frame of an animated resize loosens the view
                    // toward the full image, and the next pan/wheel commit
                    // would then store that loosened crop over the real one.
                    // Deliberate view changes all commit (pan end, wheel
                    // debounce, resize release via the grid layer), so the
                    // committed crop IS the view to preserve; it reaches
                    // this ref through the crop prop via the enter/react
                    // effect below.
                    applyTransform(initTransform(size.w, size.h, nw, nh, lastCommittedRef.current))
                } else {
                    // Sub-pixel jitter: keep the previous reference size
                    return
                }
            }
            lastSizeRef.current = size
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [nw, nh])

    // Expose the image's viewport extent while in crop mode, so the grid
    // layer can clamp box-edge drags at the image edges (a window past
    // the image frames dead space that box∩image cannot store)
    useEffect(() => {
        if (!imageExtentRef || !cropMode) return
        imageExtentRef.current = () => {
            const el = containerRef.current
            const t = transformRef.current
            if (!el || !t || !nw || !nh) return null
            const rect = el.getBoundingClientRect()
            const box = {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            }
            // Mid-drag the image is frozen at the anchor's screen position
            const anchor = anchorRef.current
            if (anchor) {
                return {
                    box,
                    image: {
                        left: anchor.left,
                        top: anchor.top,
                        right: anchor.left + nw * anchor.scale,
                        bottom: anchor.top + nh * anchor.scale,
                    },
                }
            }
            return {
                box,
                image: {
                    left: rect.left + t.x,
                    top: rect.top + t.y,
                    right: rect.left + t.x + nw * t.scale,
                    bottom: rect.top + t.y + nh * t.scale,
                },
            }
        }
        return () => { imageExtentRef.current = null }
    }, [cropMode, nw, nh, imageExtentRef])

    // Enter/leave crop mode, and react to external crop changes (Clear Crop)
    useEffect(() => {
        if (!cropMode) {
            transformRef.current = null
            setTransform(null)
            return
        }
        if (!containerSize || !nw || !nh) return
        if (!transformRef.current || !cropEq(crop, lastCommittedRef.current)) {
            lastCommittedRef.current = crop
            applyTransform(initTransform(containerSize.w, containerSize.h, nw, nh, crop))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropMode, containerSize, nw, nh, crop?.x, crop?.y, crop?.w, crop?.h])

    // Box-resize lifecycle. The COMMIT for a box-resize does not happen
    // here: the grid layer computes box∩image synchronously at mouseup
    // (GalleryPinBoard's onResizeStop) from this component's extent
    // getter, because everything CropView knows is a frame behind the
    // pointer — the anchored view (and any crop derived from it) is fed
    // by ResizeObserver deliveries, so a fast drag ends with the last
    // ~frame of handle travel never reflected here. The grid keeps
    // moving AFTER release too (lattice snap, vertical compaction, the
    // dead-space trim, all animated by RGL's resize transition); none of
    // that can touch the committed crop since it was read at mouseup.
    // Here we only manage the drag state: capture the image's viewport
    // anchor when the resize starts, and drop it when it ends — dropping
    // the anchor puts the transform back in container coordinates, so
    // the image rides along with a translated box, and the committed
    // crop flowing back through the crop prop re-inits the view via the
    // enter/react effect above.
    useEffect(() => {
        if (boxResizing) {
            const el = containerRef.current
            const t = transformRef.current
            // The transform may not exist yet (image metadata or the first
            // size measurement still pending); the resize-observer callback
            // captures the anchor lazily in that case
            if (!el || !t) return
            const rect = el.getBoundingClientRect()
            anchorRef.current = { left: rect.left + t.x, top: rect.top + t.y, scale: t.scale }
        } else {
            anchorRef.current = null
        }
    }, [boxResizing])

    // Zoom with the scroll wheel around the cursor. Non-passive so the
    // surrounding ScrollArea doesn't scroll. Commits are debounced to avoid
    // one history entry per wheel tick.
    useEffect(() => {
        const el = containerRef.current
        if (!el || !cropMode) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            e.stopPropagation()
            const t = transformRef.current
            const size = lastSizeRef.current
            if (!t || !size || !nw || !nh) return
            const minScale = Math.min(size.w / nw, size.h / nh) // full image contain
            const maxScale = Math.min(size.w / (nw * MIN_CROP_FRAC), size.h / (nh * MIN_CROP_FRAC))
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
            const scale = Math.min(maxScale, Math.max(minScale, t.scale * factor))
            if (scale === t.scale) return
            const rect = el.getBoundingClientRect()
            const cx = e.clientX - rect.left
            const cy = e.clientY - rect.top
            const next = clampTransform({
                scale,
                x: cx - (cx - t.x) * (scale / t.scale),
                y: cy - (cy - t.y) * (scale / t.scale),
            }, size.w, size.h, nw, nh)
            applyTransform(next)
            if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current)
            wheelCommitTimerRef.current = setTimeout(() => {
                wheelCommitTimerRef.current = null
                const cur = transformRef.current
                const s = lastSizeRef.current
                if (cur && s) commit(transformToCrop(cur, s.w, s.h, nw, nh))
            }, 400)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => {
            el.removeEventListener('wheel', onWheel)
            if (wheelCommitTimerRef.current) {
                clearTimeout(wheelCommitTimerRef.current)
                wheelCommitTimerRef.current = null
                const cur = transformRef.current
                const s = lastSizeRef.current
                if (cur && s) commit(transformToCrop(cur, s.w, s.h, nw, nh))
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropMode, nw, nh])

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return
        const t = transformRef.current
        if (!t) return
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
            // Pointer may already be gone (or synthetic); pan still works
            // as long as the cursor stays over the tile
        }
        panStateRef.current = { startX: e.clientX, startY: e.clientY, t }
    }
    const onPointerMove = (e: React.PointerEvent) => {
        const ps = panStateRef.current
        const size = lastSizeRef.current
        if (!ps || !size || !nw || !nh) return
        applyTransform(clampTransform({
            scale: ps.t.scale,
            x: ps.t.x + (e.clientX - ps.startX),
            y: ps.t.y + (e.clientY - ps.startY),
        }, size.w, size.h, nw, nh))
    }
    const endPan = () => {
        if (!panStateRef.current) return
        panStateRef.current = null
        const t = transformRef.current
        const size = lastSizeRef.current
        if (t && size && nw && nh) commit(transformToCrop(t, size.w, size.h, nw, nh))
    }

    // Both modes render the same element tree (container > clip > media) and
    // differ only in styles, so the media element — possibly a playing
    // <video> — survives mode toggles instead of being remounted (which
    // would reset playback).
    const fallbackStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
    }
    const fullClip: React.CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' }

    // Fallbacks: natural dimensions unknown (or transform not initialized
    // yet in crop mode) — plain letterboxed view
    let clipStyle = fullClip
    let mediaStyle = fallbackStyle
    let ghostStyle: React.CSSProperties | null = null

    if (cropMode) {
        if (transform && nw && nh) {
            mediaStyle = {
                position: 'absolute',
                left: transform.x,
                top: transform.y,
                width: nw * transform.scale,
                height: nh * transform.scale,
                maxWidth: 'none',
                objectFit: 'fill',
            }
            ghostStyle = { ...mediaStyle, objectFit: undefined }
        }
    } else if (containerSize && nw && nh) {
        const geom = computeRestGeometry(containerSize.w, containerSize.h, crop ?? FULL_CROP, nw, nh)
        clipStyle = { left: geom.visL, top: geom.visT, width: geom.visW, height: geom.visH }
        mediaStyle = {
            position: 'absolute',
            left: geom.imgL - geom.visL,
            top: geom.imgT - geom.visT,
            width: geom.imgW,
            height: geom.imgH,
            maxWidth: 'none',
            objectFit: 'fill',
        }
    } else if (crop) {
        // A crop exists but the geometry to apply it isn't known yet: on
        // the server, during hydration, and while natural dimensions load.
        // object-view-box makes the browser contain-fit exactly the crop
        // region without JS knowing the image's dimensions, so the SSR
        // HTML itself paints the cropped view — no empty box and no
        // uncropped flash before the JS geometry takes over (which
        // produces the same centered contain fit, so the handoff is
        // seamless). Browsers without object-view-box support ignore it
        // and briefly show the full contain fit instead.
        mediaStyle = {
            ...fallbackStyle,
            objectViewBox: `inset(${crop.y * 100}% ${(1 - crop.x - crop.w) * 100}% `
                + `${(1 - crop.y - crop.h) * 100}% ${crop.x * 100}%)`,
        } as React.CSSProperties
    }

    return (
        <div
            ref={containerRef}
            className={"absolute top-0 left-0 w-full h-full"
                + (cropMode ? " rounded ring-2 ring-inset ring-blue-500" : "")}
        >
            {ghostStyle && ghostSrc ? (
                <img
                    src={ghostSrc}
                    alt=""
                    draggable={false}
                    className="absolute opacity-30 pointer-events-none select-none"
                    style={ghostStyle}
                />
            ) : null}
            <div className="absolute overflow-hidden rounded" style={clipStyle}>
                {renderMedia(mediaStyle)}
            </div>
            {cropMode && transform ? (
                <div
                    className="absolute top-0 left-0 w-full h-full cursor-grab active:cursor-grabbing touch-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endPan}
                    onPointerCancel={endPan}
                />
            ) : null}
        </div>
    )
}
