'use client'
import React, { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { GridParams, rowStep } from "@/lib/pinboardGrid"
import { GridRect } from "@/lib/pinboardPack"
import { freeRuns, intersectRect, pickRectAt } from "@/lib/pinboardHoles"

// Targeting overlay for hole placement, shared by the board's three
// hole-aware gestures:
//  - "verb": Move to Hole — pick a hole for the current selection.
//    Interactive; click places, click-drag carves a sub-rect.
//  - "carry": sticky carry — an image rides the cursor. With Shift held
//    the drop snaps to holes (carve works here too); without, a
//    default-size ghost follows the cursor and drops in place, evicting
//    whatever it lands on. Right-click cancels the carry.
//  - "drag": HTML5 drag with Shift held — visual only (the OS owns the
//    pointer), driven by dragPoint from the board's dragover tracking;
//    the board itself commits on drop.
// The overlay paints the free mask faintly (the mode indicator), the
// candidate rect under the cursor with the same red drop shadow RGL's
// placeholder uses, and an RTS-style "can't drop here" state (dashed +
// cross) when the target doesn't fit the payload. Candidates are the
// maximal free rectangles; the one whose center the cursor is
// proportionally nearest wins, alternates under the cursor show as
// dashed outlines (see lib/pinboardHoles.ts).
export function HoleTargetOverlay({
    grid,
    gridWidth,
    contentHeight,
    rows,
    occupied,
    freeRects,
    mode,
    dragPoint = null,
    carryGhost,
    validHole,
    validFree,
    onCommit,
    onMiss,
    onCancel,
}: {
    grid: GridParams
    gridWidth: number
    // Pixel height to cover (the grid content can overflow the board's
    // fixed-height box)
    contentHeight: number
    // Free-mask bound in grid rows
    rows: number
    occupied: GridRect[]
    // Maximal free rects over the same mask (computed by the board, which
    // also needs them for drag-mode drops)
    freeRects: GridRect[]
    mode: "verb" | "carry" | "drag"
    // Cursor in container px, for drag mode only
    dragPoint?: { x: number, y: number } | null
    // Grid-unit size of the free-place ghost, for carry mode only
    carryGhost?: { w: number, h: number }
    validHole: (r: GridRect) => boolean
    validFree?: (r: GridRect) => boolean
    onCommit: (r: GridRect, kind: "hole" | "free") => void
    onMiss: (msg: string) => void
    onCancel: () => void
}) {
    const columns = grid.columns
    const colW = (gridWidth - 2 * grid.padding - (columns - 1) * grid.margin) / columns
    const unitX = colW + grid.margin
    const unitY = rowStep(grid)
    const toCell = (px: number, py: number) => ({
        gx: (px - grid.padding) / unitX,
        gy: (py - grid.padding) / unitY,
    })
    const rectPx = (r: GridRect): React.CSSProperties => ({
        left: grid.padding + r.x * unitX,
        top: grid.padding + r.y * unitY,
        width: r.w * unitX - grid.margin,
        height: r.h * unitY - grid.margin,
    })

    const runs = useMemo(
        () => freeRuns(occupied, columns, rows),
        [occupied, columns, rows])

    // Cursor in fractional grid units; drag mode is driven by the prop
    const [mouse, setMouse] = useState<{ gx: number, gy: number } | null>(null)
    const [shift, setShift] = useState(false)
    // Carve gesture: anchor cell + the candidate it started in. Mirrored
    // in a ref because the commit derives its target from the RELEASE
    // event's own coordinates — state from the last render can lag a fast
    // press-move-release
    const [carve, setCarve] = useState<{ cx: number, cy: number, base: GridRect } | null>(null)
    const carveRef = useRef<typeof carve>(null)
    const setCarveBoth = (c: typeof carve) => { carveRef.current = c; setCarve(c) }
    const cursor = mode === "drag"
        ? (dragPoint ? toCell(dragPoint.x, dragPoint.y) : null)
        : mouse

    // Esc cancels; Shift is also tracked via keys so the carry ghost
    // switches modes even while the mouse is still
    useEffect(() => {
        if (mode === "drag") return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel()
            if (e.key === "Shift") setShift(true)
        }
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Shift") setShift(false)
        }
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener("keyup", onKeyUp)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("keyup", onKeyUp)
        }
    }, [mode, onCancel])

    const holeMode = mode === "verb" || mode === "drag" || (mode === "carry" && shift)
    const picked = holeMode && cursor
        ? pickRectAt(freeRects, cursor.gx, cursor.gy)
        : null
    const alternates = holeMode && cursor
        ? freeRects.filter(r => r !== picked
            && cursor.gx >= r.x && cursor.gx < r.x + r.w
            && cursor.gy >= r.y && cursor.gy < r.y + r.h)
        : []
    const cellOf = (gx: number, gy: number) => ({
        cx: Math.min(Math.max(Math.floor(gx), 0), columns - 1),
        cy: Math.max(Math.floor(gy), 0),
    })
    const carveAt = (
        c: { cx: number, cy: number, base: GridRect },
        gx: number, gy: number,
    ): GridRect | null => {
        const cur = cellOf(gx, gy)
        if (cur.cx === c.cx && cur.cy === c.cy) return null
        const box = {
            x: Math.min(c.cx, cur.cx),
            y: Math.min(c.cy, cur.cy),
            w: Math.abs(cur.cx - c.cx) + 1,
            h: Math.abs(cur.cy - c.cy) + 1,
        }
        // The anchor cell is inside the base, so this never comes up empty
        return intersectRect(box, c.base)
    }
    const freeAt = (gx: number, gy: number): GridRect | null =>
        carryGhost
            ? {
                x: Math.min(
                    Math.max(Math.round(gx - carryGhost.w / 2), 0),
                    Math.max(0, columns - carryGhost.w)),
                y: Math.max(Math.round(gy - carryGhost.h / 2), 0),
                w: carryGhost.w,
                h: carryGhost.h,
            }
            : null
    const carveRect = carve && cursor ? carveAt(carve, cursor.gx, cursor.gy) : null
    const freeRect = mode === "carry" && !shift && cursor
        ? freeAt(cursor.gx, cursor.gy)
        : null

    const target = holeMode ? (carveRect ?? picked) : freeRect
    const targetValid = target !== null && (holeMode
        ? validHole(target)
        : (validFree?.(target) ?? true))

    // Derives everything from the release event so a fast gesture can't
    // commit a stale render's target
    const commit = (gx: number, gy: number, shiftNow: boolean) => {
        const holeMode = mode === "verb" || mode === "drag"
            || (mode === "carry" && shiftNow)
        const c = carveRef.current
        const target = holeMode
            ? ((c ? carveAt(c, gx, gy) : null) ?? pickRectAt(freeRects, gx, gy))
            : freeAt(gx, gy)
        if (holeMode) {
            if (!target) {
                onMiss(mode === "carry"
                    ? "No hole here — release Shift to place freely, or right-click to cancel"
                    : "No hole here — click a highlighted empty area (Esc cancels)")
                return
            }
            if (!validHole(target)) {
                onMiss("That hole is too small for what you're placing")
                return
            }
            onCommit(target, "hole")
        } else {
            if (!target) return
            if (!(validFree?.(target) ?? true)) {
                onMiss("Can't place over an anchored item")
                return
            }
            onCommit(target, "free")
        }
    }

    const hint = mode === "verb"
        ? "Click a hole to move the selection there · drag to carve a spot · Esc cancels"
        : mode === "carry"
            ? (shift
                ? "Hole mode: drop into a highlighted hole · release Shift to place freely"
                : "Click to place (items in the way drop below) · hold Shift to snap to holes · right-click cancels")
            : "Drop into a highlighted hole · release Shift for a normal drop"

    return (
        <div
            data-hole-overlay
            className={cn(
                "absolute left-0 top-0 w-full z-30",
                mode === "drag"
                    ? "pointer-events-none"
                    : targetValid || target === null ? "cursor-crosshair" : "cursor-not-allowed",
            )}
            style={{ height: contentHeight }}
            onPointerDown={(e) => {
                // The board's marquee arms on background pointerdowns —
                // targeting presses are never selection gestures
                e.stopPropagation()
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                const { gx, gy } = toCell(
                    e.clientX - e.currentTarget.getBoundingClientRect().left,
                    e.clientY - e.currentTarget.getBoundingClientRect().top)
                setMouse({ gx, gy })
                setShift(e.shiftKey)
                const base = (mode === "verb" || (mode === "carry" && e.shiftKey))
                    ? pickRectAt(freeRects, gx, gy)
                    : null
                if (base) setCarveBoth({ ...cellOf(gx, gy), base })
            }}
            onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setMouse(toCell(e.clientX - rect.left, e.clientY - rect.top))
                setShift(e.shiftKey)
            }}
            onPointerUp={(e) => {
                if (e.button !== 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                const { gx, gy } = toCell(e.clientX - rect.left, e.clientY - rect.top)
                commit(gx, gy, e.shiftKey)
                setCarveBoth(null)
            }}
            onPointerLeave={() => { setMouse(null); setCarveBoth(null) }}
            onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onCancel()
            }}
        >
            {/* The free mask, faintly: the standing "you are targeting
                holes" indicator */}
            {runs.map((r, i) => (
                <div
                    key={i}
                    className="absolute pointer-events-none rounded-xs bg-red-400/10"
                    style={rectPx(r)}
                />
            ))}
            {/* Other candidates under the cursor: pickable by moving
                toward their center (or by carving) */}
            {alternates.map((r, i) => (
                <div
                    key={i}
                    className="absolute pointer-events-none rounded-xs border border-dashed border-red-400/50"
                    style={rectPx(r)}
                />
            ))}
            {target && (
                <div
                    className={cn(
                        "absolute pointer-events-none rounded-xs flex items-center justify-center",
                        "transition-[left,top,width,height] duration-75",
                        targetValid
                            ? "bg-red-500/30 border-2 border-red-500/80"
                            : "bg-red-500/10 border-2 border-dashed border-red-500/60",
                    )}
                    style={rectPx(target)}
                >
                    {!targetValid && <X className="w-6 h-6 text-red-500/90" />}
                </div>
            )}
            {/* Fixed so it stays readable however far the board is
                scrolled */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none rounded-full bg-black/70 text-white text-xs px-3 py-1.5 whitespace-nowrap">
                {hint}
            </div>
        </div>
    )
}
