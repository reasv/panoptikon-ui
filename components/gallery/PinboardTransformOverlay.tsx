'use client'
import React, { useEffect, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { GridParams, minPinUnits, rowStep } from "@/lib/pinboardGrid"

// The Scale & Move session: a modal overlay that owns the board's pointer
// while it runs, drawing one bounding box around the current selection.
// Dragging the box interior moves the whole group; dragging a handle
// scales every member about the opposite edge/corner — corners uniformly,
// edges along one axis. The session is modal on purpose: for the outermost
// selected items the group bbox edge coincides with their own edges, which
// is exactly where their per-item resize handles and overlay buttons live,
// so a passive always-on bbox would fight them for the same pixels. With
// item interaction suspended, the handles can also sit INSIDE the box —
// a selection flush against the viewport edge needs no exterior space.
//
// The live preview is continuous and imperative: each pointer frame writes
// transform/width/height directly onto the selected items' grid elements
// (the same inline styles RGL itself positions them with), so the real
// pins move and reflow exactly as they do during a native RGL resize —
// no ghost boxes, no scale() distortion of the content. React never
// fights these writes mid-gesture: RGL's own style props are unchanged
// while the gesture runs, so its diff skips them. On release the parent
// snaps the continuous rects to the lattice and commits them as one verb
// write; the preview styles are held until that write's new layout
// arrives (or a fallback timeout fires) and are then re-stamped with the
// resting values, so the items never flash back through their old
// positions. The gesture works in mouse events, not pointer events, on
// purpose: the board's gesture autoscroll extends a drag past the
// viewport edge by dispatching synthetic mousemoves at the parked pointer
// position, and the preview must follow those like RGL does.
export interface TransformPxRect {
    key: string
    l: number
    t: number
    w: number
    h: number
}

// A scale commit's actual transform: the final clamped factors and the
// handle that anchored them. The board snaps scales from THIS (in lattice
// space, about the anchor's integer edge), not from the preview's px
// rects — see commitTransform for why px-edge rounding can't keep flush
// members flush on shrinks.
export interface TransformScale {
    sx: number
    sy: number
    handle: string
}

type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se"

// All eight handles in both gravity modes. The per-item north handles
// are dropped while gravity is on (GRAVITY_RESIZE_HANDLES) because RGL's
// resize re-anchors the box to its compacted position mid-gesture and the
// handle inverts — but this overlay never uses RGL's resize, so that
// failure cannot happen here. A north-anchored scale simply commits, and
// gravity settles the result like it settles any other commit.
const ALL_HANDLES: Handle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"]

const HANDLE_CURSOR: Record<Handle, string> = {
    n: "cursor-ns-resize", s: "cursor-ns-resize",
    e: "cursor-ew-resize", w: "cursor-ew-resize",
    nw: "cursor-nwse-resize", se: "cursor-nwse-resize",
    ne: "cursor-nesw-resize", sw: "cursor-nesw-resize",
}
// All handles sit INSIDE the box edges (see the header comment)
const HANDLE_POS: Record<Handle, string> = {
    nw: "left-0 top-0",
    n: "left-1/2 top-0 -translate-x-1/2",
    ne: "right-0 top-0",
    w: "left-0 top-1/2 -translate-y-1/2",
    e: "right-0 top-1/2 -translate-y-1/2",
    sw: "left-0 bottom-0",
    s: "left-1/2 bottom-0 -translate-x-1/2",
    se: "right-0 bottom-0",
}

// Pointer travel below this many px is a click, not a gesture — the same
// threshold the board's selection-vs-drag guards use
const MOVE_THRESHOLD = 3
// If a commit produces no layout change the overlay can't see (a write
// swallowed upstream), restore the resting styles anyway after this long
const RESTORE_FALLBACK_MS = 1500

interface Gesture {
    kind: "move" | Handle
    startX: number
    startY: number
    rects0: TransformPxRect[]
    els: Map<string, HTMLElement>
    moved: boolean
    last: TransformPxRect[] | null
    sx: number
    sy: number
    onMove: (e: MouseEvent) => void
    onUp: (e: MouseEvent) => void
}

export function PinboardTransformOverlay({
    grid,
    gridWidth,
    contentHeight,
    items,
    gridAreaRef,
    onGesture,
    onCommit,
    onExit,
}: {
    grid: GridParams
    gridWidth: number
    // Pixel height to cover (the grid content can overflow the board's
    // fixed-height box, same as the hole overlay)
    contentHeight: number
    // The selected items' resting rects in content px, from the board's
    // grid math — this is also what the preview restores to
    items: TransformPxRect[]
    gridAreaRef: React.RefObject<HTMLDivElement | null>
    // Gesture start/end: the parent freezes the scroll range (with its
    // autoscroll) and wears the transition-disable class while true
    onGesture: (active: boolean) => void
    // Commit the released gesture: the continuous rects for a move, plus
    // the clamped transform itself for a scale. Returns false when the
    // snap changes nothing — the overlay then restores the resting styles
    // itself instead of waiting for a layout change that never comes.
    onCommit: (rects: TransformPxRect[], kind: "move" | "scale",
        scale?: TransformScale) => boolean
    onExit: () => void
}) {
    const bboxRef = useRef<HTMLDivElement | null>(null)
    const gestureRef = useRef<Gesture | null>(null)
    // Preview styles held past a commit, waiting for the new layout
    const pendingRef = useRef<Map<string, HTMLElement> | null>(null)
    const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const itemsRef = useRef(items)
    // Latest-value refs for the listeners and cleanups below
    const onGestureRef = useRef(onGesture); onGestureRef.current = onGesture
    const onCommitRef = useRef(onCommit); onCommitRef.current = onCommit
    const onExitRef = useRef(onExit); onExitRef.current = onExit

    const bbox = useMemo(() => {
        const L = Math.min(...items.map(r => r.l))
        const T = Math.min(...items.map(r => r.t))
        const R = Math.max(...items.map(r => r.l + r.w))
        const B = Math.max(...items.map(r => r.t + r.h))
        return { L, T, W: R - L, H: B - T }
    }, [items])

    // Stamp the given rects onto the items' grid elements and the bbox
    // chrome. Mid-gesture React re-renders can't undo this: RGL's style
    // props haven't changed, so its diff skips the elements.
    const applyRects = (els: Map<string, HTMLElement>, rects: TransformPxRect[]) => {
        for (const r of rects) {
            const el = els.get(r.key)
            if (!el) continue
            el.style.transform = `translate(${r.l}px,${r.t}px)`
            el.style.width = `${r.w}px`
            el.style.height = `${r.h}px`
        }
        const box = bboxRef.current
        if (box) {
            const L = Math.min(...rects.map(r => r.l))
            const T = Math.min(...rects.map(r => r.t))
            box.style.left = `${L}px`
            box.style.top = `${T}px`
            box.style.width = `${Math.max(...rects.map(r => r.l + r.w)) - L}px`
            box.style.height = `${Math.max(...rects.map(r => r.t + r.h)) - T}px`
        }
    }
    // Back to the resting positions of the CURRENT items prop — which,
    // after a commit's layout landed, are the committed values React is
    // about to (or already did) render itself
    const restoreEls = (els: Map<string, HTMLElement>) => {
        applyRects(els, itemsRef.current)
    }
    const clearPending = (restore: boolean) => {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
        if (pendingRef.current && restore) restoreEls(pendingRef.current)
        pendingRef.current = null
    }
    // The commit's new layout arrived: re-stamp the (now resting) styles
    useEffect(() => {
        itemsRef.current = items
        if (pendingRef.current) clearPending(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items])

    const endGesture = (g: Gesture) => {
        window.removeEventListener("mousemove", g.onMove)
        window.removeEventListener("mouseup", g.onUp)
        gestureRef.current = null
        onGestureRef.current(false)
    }
    const cancelGesture = () => {
        const g = gestureRef.current
        if (!g) return
        endGesture(g)
        if (g.moved) restoreEls(g.els)
    }

    const beginGesture = (kind: "move" | Handle, e: React.MouseEvent) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const area = gridAreaRef.current
        // One gesture at a time; and while a commit's preview is still
        // held, the resting rects are stale — the next gesture starts
        // when the layout lands (a beat later on the session's first
        // commit, which fetches metadata)
        if (!area || gestureRef.current || pendingRef.current) return
        const areaRect = area.getBoundingClientRect()
        const rects0 = itemsRef.current
        if (rects0.length === 0) return
        const els = new Map<string, HTMLElement>()
        const want = new Set(rects0.map(r => r.key))
        for (const el of area.querySelectorAll<HTMLElement>("[data-pin-key]")) {
            const k = el.dataset.pinKey
            if (k && want.has(k)) els.set(k, el)
        }
        const L0 = Math.min(...rects0.map(r => r.l))
        const T0 = Math.min(...rects0.map(r => r.t))
        const R0 = Math.max(...rects0.map(r => r.l + r.w))
        const B0 = Math.max(...rects0.map(r => r.t + r.h))
        const W0 = R0 - L0
        const H0 = B0 - T0
        // The board's inner extent: columns are a hard horizontal bound,
        // the top edge a vertical one; downward is open-ended
        const innerL = grid.padding
        const innerR = gridWidth - grid.padding
        const innerT = grid.padding
        // The group scale floor: the gesture stops when the smallest
        // member hits the minimum pin size, measured in grid units with
        // half a unit of slack so the commit's lattice snap — whose
        // rounding can cost up to one unit — can never land a member
        // below minW/minH and trip the mutation floor. CAPPED AT 1: a
        // member already at (or below) the minimum makes its floor ratio
        // exceed 1, and an uncapped lower clamp bound would then teleport
        // ANY inward drag to a growing scale — drag in, group jumps out.
        // Held at 1, the gesture simply refuses to shrink past the
        // current size (growing still works), which is the honest
        // reading of "a member is already at minimum".
        const colW = (gridWidth - 2 * grid.padding
            - (grid.columns - 1) * grid.margin) / grid.columns
        const unitX = colW + grid.margin
        const stepY = rowStep(grid)
        const { minW, minH } = minPinUnits(grid, colW)
        const sxMin = Math.min(1, Math.max(
            ...rects0.map(r => (minW + 0.5) * unitX / (r.w + grid.margin))))
        const syMin = Math.min(1, Math.max(
            ...rects0.map(r => (minH + 0.5) * stepY / (r.h + grid.margin))))
        const clamp = (v: number, lo: number, hi: number) =>
            Math.min(Math.max(v, lo), Math.max(lo, hi))
        const g: Gesture = {
            kind,
            startX: e.clientX - areaRect.left,
            startY: e.clientY - areaRect.top,
            rects0, els, moved: false, last: null, sx: 1, sy: 1,
            onMove: (ev: MouseEvent) => {
                if (gestureRef.current !== g) return
                const ar = gridAreaRef.current?.getBoundingClientRect()
                if (!ar) return
                const cx = ev.clientX - ar.left
                const cy = ev.clientY - ar.top
                if (!g.moved
                    && Math.hypot(cx - g.startX, cy - g.startY) <= MOVE_THRESHOLD) return
                g.moved = true
                let rects: TransformPxRect[]
                if (g.kind === "move") {
                    const dx = clamp(cx - g.startX, innerL - L0, innerR - R0)
                    const dy = Math.max(cy - g.startY, innerT - T0)
                    rects = g.rects0.map(r => ({ ...r, l: r.l + dx, t: r.t + dy }))
                } else {
                    const k = g.kind
                    // The anchor is the fixed opposite edge/corner
                    const ax = k.includes("w") ? R0 : L0
                    const ay = k.includes("n") ? B0 : T0
                    const horiz = k.includes("e") || k.includes("w")
                    const vert = k.includes("n") || k.includes("s")
                    const vx = k.includes("w") ? ax - cx : cx - ax
                    const vy = k.includes("n") ? ay - cy : cy - ay
                    const sxMax = horiz
                        ? (k.includes("w") ? R0 - innerL : innerR - L0) / W0
                        : Infinity
                    const syMax = k.includes("n") ? (B0 - innerT) / H0 : Infinity
                    let sx = 1
                    let sy = 1
                    if (horiz && vert) {
                        // Corner: one uniform factor, the pointer's travel
                        // projected onto the box diagonal (the smooth,
                        // aspect-weighted mean of the per-axis ratios)
                        const s = clamp(
                            (vx * W0 + vy * H0) / (W0 * W0 + H0 * H0),
                            Math.max(sxMin, syMin), Math.min(sxMax, syMax))
                        sx = s
                        sy = s
                    } else if (horiz) {
                        sx = clamp(vx / W0, sxMin, sxMax)
                    } else {
                        sy = clamp(vy / H0, syMin, syMax)
                    }
                    g.sx = sx
                    g.sy = sy
                    rects = g.rects0.map(r => ({
                        key: r.key,
                        l: ax + sx * (r.l - ax),
                        t: ay + sy * (r.t - ay),
                        w: sx * r.w,
                        h: sy * r.h,
                    }))
                }
                g.last = rects
                applyRects(g.els, rects)
            },
            onUp: () => {
                if (gestureRef.current !== g) return
                endGesture(g)
                if (!g.moved || !g.last) return
                const committed = onCommitRef.current(
                    g.last, g.kind === "move" ? "move" : "scale",
                    g.kind === "move"
                        ? undefined
                        : { sx: g.sx, sy: g.sy, handle: g.kind })
                if (committed) {
                    // Hold the preview until the committed layout lands
                    pendingRef.current = g.els
                    pendingTimerRef.current = setTimeout(
                        () => clearPending(true), RESTORE_FALLBACK_MS)
                } else {
                    restoreEls(g.els)
                }
            },
        }
        gestureRef.current = g
        onGestureRef.current(true)
        window.addEventListener("mousemove", g.onMove)
        window.addEventListener("mouseup", g.onUp)
    }

    // Esc cancels an in-flight gesture; at rest it finishes the session.
    // The board's own Esc handler stands down while the session runs.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return
            if (gestureRef.current) cancelGesture()
            else onExitRef.current()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // Unmount mid-gesture or mid-hold (selection changed, board left):
    // put the items back on their resting styles
    useEffect(() => () => {
        const g = gestureRef.current
        if (g) {
            endGesture(g)
            if (g.moved) restoreEls(g.els)
        }
        clearPending(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handles = ALL_HANDLES
    return (
        <div
            data-transform-overlay
            // Scale & Move is a MODAL BOARD GESTURE and cancels on Esc (see
            // the handler above), so surfaces that would otherwise take Esc
            // stand down while it runs — SearchViewer's guard explains the
            // attribute and why it is not the identity one beside it.
            data-esc-owner
            className="absolute left-0 top-0 z-40 w-full"
            style={{ height: contentHeight }}
            // Never let a press under the session reach the board (marquee
            // starts, RGL drags); the document-level deselect handler
            // exempts the overlay by its data attribute
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
                // Backdrop press — outside the bbox — finishes the session
                if (e.target !== e.currentTarget || e.button !== 0) return
                e.preventDefault()
                onExit()
            }}
            onContextMenu={(e) => { e.preventDefault(); onExit() }}
        >
            <div
                ref={bboxRef}
                className="absolute cursor-move rounded-xs border-2 border-blue-400 bg-blue-400/10"
                style={{ left: bbox.L, top: bbox.T, width: bbox.W, height: bbox.H }}
                onMouseDown={(e) => beginGesture("move", e)}
            >
                {handles.map(h => (
                    <div
                        key={h}
                        className={cn(
                            "absolute z-10 flex h-5 w-5 items-center justify-center",
                            HANDLE_POS[h], HANDLE_CURSOR[h])}
                        onMouseDown={(e) => beginGesture(h, e)}
                    >
                        <div className="h-3 w-3 rounded-[2px] border-2 border-blue-500 bg-white shadow-sm" />
                    </div>
                ))}
            </div>
        </div>
    )
}
