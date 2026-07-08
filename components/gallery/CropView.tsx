'use client'

import React, { useEffect, useRef, useState } from 'react'
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

// Initial view for a stored crop: contain-fit it, then, on any axis where
// content is actually cropped away, raise the scale until the crop fills
// the box on that axis. This keeps hidden content from ever sitting
// full-opacity in a letterbox band, while an uncropped axis still shows
// its letterbox (which the user can then eliminate by zooming/panning).
function initTransform(boxW: number, boxH: number, nw: number, nh: number, crop: CropRect | null): Transform {
    const c = crop ?? FULL_CROP
    const cropW = c.w * nw
    const cropH = c.h * nh
    let scale = Math.min(boxW / cropW, boxH / cropH)
    const eps = 0.001
    if (c.w < 1 - eps) scale = Math.max(scale, boxW / cropW)
    if (c.h < 1 - eps) scale = Math.max(scale, boxH / cropH)
    return clampTransform({
        scale,
        x: boxW / 2 - (c.x + c.w / 2) * nw * scale,
        y: boxH / 2 - (c.y + c.h / 2) * nh * scale,
    }, boxW, boxH, nw, nh)
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

export function CropView({
    crop,
    cropMode,
    boxResizing,
    naturalWidth,
    naturalHeight,
    onCropChange,
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
    const onCropChangeRef = useRef(onCropChange)
    onCropChangeRef.current = onCropChange
    const lastCommittedRef = useRef<CropRect | null>(null)
    const liveCropRef = useRef<CropRect | null>(null)
    // Image position in viewport coordinates, frozen while the box resizes
    const anchorRef = useRef<{ left: number; top: number; scale: number } | null>(null)
    const lastSizeRef = useRef<{ w: number; h: number } | null>(null)
    const panStateRef = useRef<{ startX: number; startY: number; t: Transform } | null>(null)
    const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const commit = (c: CropRect) => {
        lastCommittedRef.current = c
        onCropChangeRef.current(c)
    }

    const applyTransform = (t: Transform) => {
        transformRef.current = t
        setTransform(t)
    }

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            const rect = el.getBoundingClientRect()
            const size = { w: rect.width, h: rect.height }
            setContainerSize(size)
            const t = transformRef.current
            if (cropModeRef.current && t && nw && nh) {
                const anchor = anchorRef.current
                if (anchor) {
                    // Box edges move around the screen-fixed image. The grid's
                    // snap-back is a ~200ms animation, so if a commit is
                    // pending, push it out until the size stops changing.
                    const anchored = {
                        scale: anchor.scale,
                        x: anchor.left - rect.left,
                        y: anchor.top - rect.top,
                    }
                    applyTransform(anchored)
                    liveCropRef.current = transformToCrop(anchored, size.w, size.h, nw, nh)
                    if (finishTimerRef.current) restartFinishTimer()
                } else if (lastSizeRef.current &&
                    (Math.abs(size.w - lastSizeRef.current.w) > 1 || Math.abs(size.h - lastSizeRef.current.h) > 1)) {
                    // Box changed outside a handle drag (e.g. menu resize):
                    // re-fit the current view to the new box
                    const c = transformToCrop(t, lastSizeRef.current.w, lastSizeRef.current.h, nw, nh)
                    applyTransform(initTransform(size.w, size.h, nw, nh, c))
                } else {
                    // Sub-pixel jitter: keep the previous reference size
                    return
                }
            }
            lastSizeRef.current = size
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [nw, nh])

    // Enter/leave crop mode, and react to external crop changes (Clear Crop)
    useEffect(() => {
        if (!cropMode) {
            transformRef.current = null
            setTransform(null)
            liveCropRef.current = null
            return
        }
        if (!containerSize || !nw || !nh) return
        if (!transformRef.current || !cropEq(crop, lastCommittedRef.current)) {
            lastCommittedRef.current = crop
            applyTransform(initTransform(containerSize.w, containerSize.h, nw, nh, crop))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropMode, containerSize, nw, nh, crop?.x, crop?.y, crop?.w, crop?.h])

    // Finish an anchored box-resize: runs only once the box size has been
    // stable for a beat (the grid animates its snap-back), so the image
    // never visibly moves — the crop committed is what the settled box shows
    const restartFinishTimer = () => {
        if (finishTimerRef.current) clearTimeout(finishTimerRef.current)
        finishTimerRef.current = setTimeout(() => {
            finishTimerRef.current = null
            const anchor = anchorRef.current
            anchorRef.current = null
            const el = containerRef.current
            if (!anchor || !el || !nw || !nh) return
            const rect = el.getBoundingClientRect()
            const t = {
                scale: anchor.scale,
                x: anchor.left - rect.left,
                y: anchor.top - rect.top,
            }
            if (cropModeRef.current) applyTransform(t)
            lastSizeRef.current = { w: rect.width, h: rect.height }
            commit(transformToCrop(t, rect.width, rect.height, nw, nh))
            liveCropRef.current = null
        }, 150)
    }

    useEffect(() => {
        if (boxResizing) {
            if (finishTimerRef.current) {
                clearTimeout(finishTimerRef.current)
                finishTimerRef.current = null
            }
            const el = containerRef.current
            const t = transformRef.current
            if (!el || !t) return
            const rect = el.getBoundingClientRect()
            anchorRef.current = { left: rect.left + t.x, top: rect.top + t.y, scale: t.scale }
        } else if (anchorRef.current) {
            restartFinishTimer()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
