"use client"

// The virtualized result grid and the private machinery only it uses: the
// breakpoint-driven layout hook, the overscan constant, the restore sentinel
// and the gallery-close index scan. Split out of app/search/SearchPage.tsx
// unchanged — GridPanel, one file over, is still its only caller.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import { SearchResultImage } from "@/components/SearchResultImage"
import { ResultCellSkeleton } from "@/components/ResultCellSkeleton"
import type { ViewMode } from "@/lib/state/gallery"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { useSelectedDBs } from "@/lib/state/database"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useGridScrollAnchor } from "@/lib/state/gridScroll"
import { useGridCellSize } from "@/lib/state/cellSize"
import type { GridMetricsStore } from "@/lib/state/gridMetricsBox"
import type { ResultsSource } from "@/lib/searchHooks"
import { SCROLL_CHUNK_SIZE } from "@/lib/searchRequest"
import { overscanItemsFor, topRowHighlightItem, virtualPageOf } from "@/lib/scrollMode"
import {
    AUTO_IMAGE_BOX_HEIGHT_4XL_PX,
    AUTO_IMAGE_BOX_HEIGHT_5XL_PX,
    AUTO_IMAGE_BOX_HEIGHT_PX,
    GRID_GAP_PX,
    cellWidthForColumns,
    clampCellWidth,
    columnsForCellWidth,
    imageBoxHeightForCellWidth,
    rowHeightForCellWidth,
    rowHeightForImageBox,
} from "@/lib/gridCellSize"
import { useDevicePixelRatio } from "@/hooks/useDevicePixelRatio"
import { useAnimateModeForRange } from "@/hooks/useAnimateMode"
import { useHoverPreviewTrigger } from "@/hooks/useHoverPreviewTrigger"
import { cellRange } from "@/lib/state/animatePref"
import { trackHoverPointer } from "@/lib/state/animatedPlayback"
import {
    useAnimatedFloor,
    useDisplayLoopTrigger,
    useHoverPreview,
} from "@/lib/useClientConfig"
import { useOutroSkipEnabled } from "@/lib/videoPlayerState"

// md, lg, xl, 2xl, 4xl, 5xl — the Tailwind breakpoints used by the result grid
// rows, restated for matchMedia.
//
// REM, NOT PX, and the units are the whole point: Tailwind emits these
// breakpoints in rem (the built-ins by definition, ours by necessity — see the
// sort-order note at the top of app/globals.css), and `rem` in a media query
// resolves against the browser's INITIAL font size, not the document's. So a
// reader who has raised their default font size moves the CSS breakpoints and
// not these, and the column count this array derives silently stops matching
// the grid-cols-* classes actually laid out — rows sliced N-wide over a grid
// showing M. Same numbers as before at the 16px default (768/1024/1280/1536,
// then our 2200/3000), now expressed the way the stylesheet expresses them.
const GRID_BREAKPOINTS = [
    '(min-width: 48rem)',
    '(min-width: 64rem)',
    '(min-width: 80rem)',
    '(min-width: 96rem)',
    '(min-width: 137.5rem)',
    '(min-width: 187.5rem)',
]

/**
 * The grid layout currently applied by CSS. columns must mirror the responsive
 * grid-cols-* classes on the result grid rows exactly — the CSS media queries are
 * what actually lay out the columns; this value only slices results into rows.
 * Uses matchMedia (the same engine that applies the classes) rather than reading
 * window.innerWidth in a resize handler, which can observe a stale width.
 * imageBoxHeight is the picture box's own height, which is fixed per breakpoint
 * (the `h-96 / 4xl:h-120 / 5xl:h-152` on the card's anchor, named as
 * AUTO_IMAGE_BOX_HEIGHT_* in lib/gridCellSize.ts), and rowEstimate is that plus
 * the card chrome. Reported SEPARATELY rather than folded into the estimate,
 * because the box is what the rendition tier has to be chosen against: the auto
 * layout's box is `cellWidth × this`, NOT a square, and which of its two edges
 * binds depends on the picture in it (see coverBindingEdge, and the card that
 * calls it). Accurate estimates matter:
 * scrollToIndex navigates by estimated offsets for rows that haven't been
 * measured yet.
 */
function useResultGridLayout(sidebarOpen: boolean): { columns: number, rowEstimate: number, imageBoxHeight: number } {
    // columns 0 means "not evaluated yet" (SSR and the very first client render) —
    // consumers must not lay out or scroll until this becomes a real count
    const [layout, setLayout] = useState({
        columns: 0,
        rowEstimate: rowHeightForImageBox(AUTO_IMAGE_BOX_HEIGHT_PX),
        imageBoxHeight: AUTO_IMAGE_BOX_HEIGHT_PX,
    })
    useLayoutEffect(() => {
        const queries = GRID_BREAKPOINTS.map((q) => window.matchMedia(q))
        const update = () => {
            const [md, lg, xl, xxl, xxxxl, xxxxxl] = queries.map((q) => q.matches)
            const columns = sidebarOpen
                ? (xxxxl ? 5 : xxl ? 4 : xl ? 3 : lg ? 1 : md ? 2 : 1)
                : (xxl ? 5 : xl ? 4 : lg ? 3 : md ? 2 : 1)
            const imageBoxHeight = xxxxxl
                ? AUTO_IMAGE_BOX_HEIGHT_5XL_PX
                : xxxxl ? AUTO_IMAGE_BOX_HEIGHT_4XL_PX : AUTO_IMAGE_BOX_HEIGHT_PX
            const rowEstimate = rowHeightForImageBox(imageBoxHeight)
            setLayout((prev) =>
                prev.columns === columns && prev.rowEstimate === rowEstimate
                    ? prev : { columns, rowEstimate, imageBoxHeight })
        }
        update()
        queries.forEach((q) => q.addEventListener('change', update))
        return () => queries.forEach((q) => q.removeEventListener('change', update))
    }, [sidebarOpen])
    return layout
}

// The virtualizer's row overscan, and the basis for how far ahead scroll mode
// warms chunks. Shared deliberately: rows are RENDERED ahead of the viewport,
// so the data behind them has to be ASKED FOR further ahead still, and the two
// numbers drifting apart is what would make the overscan rows the ones that
// show skeletons (see overscanItemsFor).
const GRID_OVERSCAN_ROWS = 3

// Parked in `lastWrittenAnchor` across a layout change — a view-mode switch, a
// column-count change, a row-height change — so the anchor standing in the URL
// reads as an ARRIVAL rather than as the echo of one of the grid's own writes,
// and the external-anchor effect applies it instead of skipping it. Any value
// outside the anchor's domain would do (anchors are `null` or a non-negative
// item index); −1 is the one that also makes the `null` case — a restore that
// lands on the top of the set — compare unequal, which is what a plain `null`
// sentinel would silently skip.
const RESTORE_ANCHOR_SENTINEL = -1

/**
 * Where the gallery's item sits in the source, for the ensure-visible pass on
 * gallery close.
 *
 * Pages mode scans `[0, count)` — the source IS the page's array, so this is
 * the `findIndex` it has always been. Scroll mode cannot scan a result set of
 * unbounded size and must not FETCH to look (an ensure-visible is not worth a
 * request), so its caller passes the loaded neighbourhood of the position
 * being restored, which is where an item the user just closed the gallery on
 * always is. Not found is an ordinary answer and the caller skips: a block
 * that isn't there means "not loaded", never "end of results".
 *
 * BLOCK-WISE, not index-wise, and that is a cost decision. `source.get` per
 * index resolves its chunk from scratch every time, and for a chunk that has
 * been evicted from the observed set that is a request body rebuilt and
 * re-hashed per lookup — several hundred of them for one gallery close, which
 * is a frame the user sees. `getBlock` hands over the run of rows covering an
 * index once and the scan reads them in memory (see ResultsSource.getBlock).
 * The answer is identical either way.
 */
function findSelectedIndex(
    source: ResultsSource,
    selected: { item_id: SearchResult["item_id"] },
    from: number,
    to: number
): number {
    let i = Math.max(from, 0)
    while (i < to) {
        const block = source.getBlock(i)
        if (!block) {
            // Nothing loaded here. Skip to the start of the next chunk rather
            // than probing every index inside this one — a hole is a whole
            // chunk's worth of nothing, never a single missing row.
            const next = (Math.floor(i / SCROLL_CHUNK_SIZE) + 1) * SCROLL_CHUNK_SIZE
            i = next > i ? next : i + 1
            continue
        }
        const end = Math.min(to - block.start, block.rows.length)
        for (let offset = i - block.start; offset < end; offset++) {
            if (block.rows[offset]?.item_id === selected.item_id) {
                return block.start + offset
            }
        }
        // Past this block, whatever its size — but never backwards past the
        // next chunk boundary: an EMPTY block (a past-the-end chunk that
        // answered with no rows) has `start + rows.length <= i`, and stepping
        // one index at a time through it would re-resolve the same empty block
        // 320 times. The `> i` test remains the loop's termination guarantee.
        const next = Math.max(
            block.start + block.rows.length,
            (Math.floor(i / SCROLL_CHUNK_SIZE) + 1) * SCROLL_CHUNK_SIZE
        )
        i = next > i ? next : i + 1
    }
    return -1
}

export function ResultGrid({
    source,
    mode = "pages",
    pageSize,
    onDerivedPageChange,
    countSettled = true,
    onImageClick,
    isLoading,
    resultsAreStale = false,
    showPagination = true,
    savedScrollOffsetRef,
    updateRibbonVisible = false,
    metricsStore,
}: {
    source: ResultsSource,
    mode?: ViewMode,
    /** k, the virtual-page size, for the derived page number in scroll mode. */
    pageSize: number,
    /**
     * The live position indicator (design §4): called with
     * `floor(topItem / k) + 1` and ONLY when that number changes, so scrolling
     * doesn't re-render the host per frame. Must be referentially stable — it
     * is a dependency of the scroll listener below.
     */
    onDerivedPageChange?: (page: number) => void,
    /**
     * Whether `source.count` is the count query's answer rather than the
     * still-growing loaded extent (ResultsSource.count). The anchor machinery
     * needs the difference: "past the end of the results" and "past what has
     * loaded so far" call for opposite decisions, and on a cold scroll-mode
     * load — SSR-hydrated rows, count still in flight — the second one is the
     * ordinary state, not an edge case. Always true in pages mode, where the
     * page's array IS the count.
     */
    countSettled?: boolean,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
    resultsAreStale?: boolean,
    showPagination?: boolean,
    savedScrollOffsetRef?: React.MutableRefObject<number>,
    updateRibbonVisible?: boolean,
    /**
     * Where to publish the measured cell width for the size slider's thumb
     * (lib/state/gridMetricsBox.ts). Optional: the grid is correct without one,
     * it just cannot seed a slider that has not been given the box.
     */
    metricsStore?: GridMetricsStore,
}) {
    // TanStack Virtual v3 triggers re-renders by mutating internal state,
    // which the React Compiler's memoization breaks — same as the gallery view.
    "use no memo"
    const [dbsState, __] = useSelectedDBs()
    // Referentially stable while the values are unchanged, so the memoized
    // SearchResultImage cards skip re-rendering on every scroll frame.
    const dbs = useMemo(
        () => dbsState,
        [dbsState.index_db, dbsState.user_data_db]
    )
    // The cards' click handler, made referentially stable HERE rather than
    // trusted from above. It is the one prop the host mints per render (an
    // inline arrow over a nuqs setter), and it is enough on its own to defeat
    // `React.memo` on every visible card — which is exactly what a `top` write
    // was doing after the per-cell subscriptions were hoisted out: zero cells
    // subscribed to anything, and all thirty still re-rendered because their
    // callback prop was new. A ref, not a `useCallback` over the prop: the
    // point is that the identity NEVER changes, whatever the caller does.
    const imageClickRef = useRef(onImageClick)
    imageClickRef.current = onImageClick
    const handleImageClick = useCallback((index?: number) => {
        imageClickRef.current?.(index)
    }, [])
    const parentRef = useRef<HTMLDivElement>(null)
    const [sidebarOpen] = useSideBarOpen()
    const autoLayout = useResultGridLayout(sidebarOpen)
    // THE EXPLICIT CELL SIZE (design §9). Absent is "auto" — the breakpoint
    // policy above, unchanged — and present replaces it wholesale: a target
    // cell width from which the column count and the row height both follow.
    // A hard switch, never a blend.
    const [cellSize] = useGridCellSize()
    // The row width, measured rather than derived. The auto policy needs no
    // measurement (its columns come from window-level media queries, the same
    // engine that applies the grid-cols-* classes), but "as many cells of
    // width W as fit" is a question about THIS container, and the panel is
    // narrower than the window by the sidebar, the page padding and the
    // scrollbar gutter. It is also what turns a column count into a cell
    // width for the tier choice below.
    //
    // Measured on the ROW CONTAINER (the spacer below) rather than on the
    // scroll viewport, and that is not interchangeable: the viewport carries
    // `pr-4` for the widened scrollbar, so its border box is 16px wider than
    // the rows laid out inside it — and `clientWidth` there would include that
    // padding while `contentRect` would not. The spacer has neither padding
    // nor border, so every way of measuring it agrees, and what it reports is
    // exactly the width the row's grid resolves against.
    const [containerWidth, setContainerWidth] = useState(0)
    const rowContainerRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const element = rowContainerRef.current
        if (!element) return
        const publish = (width: number) => setContainerWidth((prev) =>
            Math.abs(prev - width) < 1 ? prev : width)
        const observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1]
            if (entry) publish(entry.contentRect.width)
        })
        observer.observe(element)
        // Seeded synchronously in the layout pass that arms the observer,
        // before the browser paints: the first frame that shows cells has to
        // show them at the right tier, and the observer's own first callback
        // arrives a frame later.
        publish(element.clientWidth)
        return () => observer.disconnect()
    }, [])
    // CLAMPED ON READ rather than trusted. `cs` is a hand-editable URL integer
    // and nothing upstream bounds it: `?cs=0` or `?cs=-5` asks
    // `columnsForCellWidth` for cells of no width, which answers 0 columns —
    // and 0 columns is the grid's "not measured yet" state, so the page would
    // render no cells, no skeletons and no scroll space at all, with no way
    // back except editing the URL. The clamp is the one the slider itself
    // applies, so every value the control can produce passes through
    // unchanged and only an out-of-range URL moves.
    const explicitCellSize = cellSize === null ? null : clampCellWidth(cellSize)
    const explicitSize = explicitCellSize !== null && containerWidth > 0
    const columns = explicitSize
        ? columnsForCellWidth(containerWidth, explicitCellSize, GRID_GAP_PX)
        : autoLayout.columns
    // What a cell is actually WIDE, in either mode: the slider's target is a
    // target, and the columns it produces then share the container evenly.
    // 0 while the container is unmeasured, which reads as "unknown" to the
    // tier choice and answers `display` — the conservative direction.
    const cellWidth = cellWidthForColumns(containerWidth, columns, GRID_GAP_PX)
    // The picture box's HEIGHT in CSS px, for the card (explicit mode only —
    // `undefined` is what leaves the breakpoint classes standing). Declared
    // here rather than beside `rowEstimate` because the box below is built
    // from it.
    const imageHeightPx = explicitSize && cellWidth > 0
        ? imageBoxHeightForCellWidth(cellWidth)
        : undefined
    // THE HEIGHT THE BOX ACTUALLY HAS, in either mode: the explicit size's
    // inline style, or the breakpoint class the auto layout is wearing. The
    // one above is a style DIRECTIVE and is absent in auto mode; this is the
    // FACT, and every cell has one.
    const imageBoxHeight = imageHeightPx ?? autoLayout.imageBoxHeight
    const dpr = useDevicePixelRatio()
    // ONE BOX FOR THE WHOLE GRID — NOT ONE TIER. The three numbers below are
    // this grid's entire layout answer, and they go down as stable primitives;
    // the CARD turns them into a rendition tier, because that choice depends
    // on the ROW as well (components/SearchResultImage.tsx, `cellTier`).
    //
    // WHY IT MOVED. The tier is bound by the edge of the box that the
    // picture's SHORT side has to cover under `object-cover`, and which edge
    // that is depends on the picture: a portrait image in the 5xl band's
    // 500×608 box is bound by the 500, a landscape one by the 608. A
    // grid-level answer can only be the worst case (`max` of the two edges),
    // which in that band escalated EVERY cell from grid-s to grid-m — four
    // times the decoded pixels, for the majority of cells that never needed
    // them. See `coverBindingEdge`; the worst case, `cellBoxBindingEdge`, is
    // still what a card with no dimensions on record gets.
    //
    // STILL NOT A SUBSCRIPTION PER CARD, which is the invariant F1 left
    // behind and this does not touch: the measurement, the media query and
    // the DPR hook are all here, once, and what the card does with their
    // output is arithmetic.
    // ONE FLOOR FOR THE WHOLE GRID, on the same rule as the box above it: a
    // card decides `<img>` vs `<video>` from its own row, but the numbers it
    // decides against are the server's and identical for every card, so they
    // are read here and passed down rather than subscribed to per cell.
    const animatedFloor = useAnimatedFloor()
    // AND ONE SET OF DISPLAY-LOOP BOUNDS, read here for exactly the reason the
    // floor above it is: the numbers are the server's and identical for every
    // card, so a subscription per cell would buy nothing and cost what F1
    // removed. The only card that reads them is the extreme-aspect one, whose
    // hover swap has no `display` picture to swap to past these bounds.
    //
    // A READ, NOT AN EFFECT — deliberately placed among the other two client-
    // config reads and NOT among the effects below, whose declaration ORDER is
    // load-bearing (see the bookkeeping map).
    const displayLoopTrigger = useDisplayLoopTrigger()
    // ONE ANSWER FOR THE WHOLE GRID again, and the last of the three the cards
    // are handed: which range this grid's cells fall in decides which mode the
    // user's preference resolves to (D2). The RANGE is computed here rather
    // than inside the hook so this line says what the answer depends on; the
    // cards ask the same question of their own width for the other policy that
    // turns on it (D9, which of a video's two thumbnails).
    const animateMode = useAnimateModeForRange(cellRange(cellWidth))
    // AND THE FOURTH, on exactly the same rule: what a hovered video cell may
    // do here — the server's `hover_preview` with the browser preference
    // already subtracted (V7/V8). One of four interned constants, so it is a
    // memo-stable prop; both of its inputs are subscriptions, and reading
    // either per card is what F1 removed.
    const hoverPreview = useHoverPreview()
    // AND THE OUTRO-SKIP PREFERENCE (docs/video-outro-skip-design.md): the
    // same global the gallery player follows, so a video cell's preview ends
    // where its playback would — at the detected end card — while it is on.
    // Read here once, on the rule of the four above: one boolean for every
    // card on the page, never a subscription per card.
    const outroSkip = useOutroSkipEnabled()
    // AND THE FIFTH: WHERE the pointer has to rest for one of those previews
    // to start (T1). A browser preference with no server half at all — the
    // server has no say in a gesture — read here on the same rule as the four
    // above it: one string for every card on the page, and a subscription per
    // card is what F1 removed.
    const previewTrigger = useHoverPreviewTrigger()
    // The pointer tracking the hover arming is written in terms of, bound for
    // as long as this grid is mounted rather than by the cells (which mount by
    // the hundred, and would each bind it a moment too late to answer the
    // first `pointerenter` they get). One listener, refcounted with the
    // filmstrip's — see trackHoverPointer.
    useEffect(() => trackHoverPointer(), [])
    const rowEstimate = imageHeightPx !== undefined
        ? rowHeightForCellWidth(cellWidth)
        : autoLayout.rowEstimate
    // THE CELL WIDTH, PUBLISHED TO CSS (B1). The overlay chrome inside every
    // card scales with it — a 40px button pair and 8px corner insets are
    // right on a 400px cell and swallow a 150px one — and the ramp that does
    // it is a `clamp()` over this custom property (app/globals.css, the
    // "grid cell chrome" block). Written on the row container, whose
    // descendants are every card, so one property write per layout change
    // reaches all of them.
    //
    // A DOM WRITE RATHER THAN A PROP, and that is the whole reason it is CSS:
    // handing the number down would re-render every visible card on every
    // resize tick, to move a button by two pixels. No React state, no cell
    // re-renders, and the value inherits into cards that mount later.
    //
    // A layout effect, so the chrome is at its final size in the same frame
    // the cells first paint at a new width. Unitless, because the ramp does
    // arithmetic on it.
    useLayoutEffect(() => {
        rowContainerRef.current?.style.setProperty("--cell-px", String(Math.round(cellWidth)))
    }, [cellWidth])
    const scroll = mode === "scroll"
    // The navigable extent. In pages mode this IS `results.length` (the source
    // wraps the page's array); in scroll mode it is the count query's answer,
    // falling back to the loaded extent while that is in flight so the scroll
    // space grows once instead of thrashing as chunks land (see
    // ResultsSource.count). Rows past the extent simply aren't rendered, which
    // is what keeps the last partial row identical in both modes.
    const itemCount = source.count
    // The rows change signal, per the ResultsSource dependency rule: every dep
    // list below lists THIS, never the source or its methods (both are minted
    // per render). In pages mode it is the results array itself, so those dep
    // lists hold the value they always held.
    const rowsIdentity = source.rowsIdentity
    const rowCount = columns > 0 ? Math.ceil(itemCount / columns) : 0

    // FIXED ROW HEIGHT (scroll mode only, design §6): the breakpoint constants
    // in useResultGridLayout *are* the row height rather than an estimate of
    // it, so scroll mode measures the first row that mounts and uses that one
    // number for every row in the set — no measureElement, no progressive
    // measurement, and therefore a scrollToIndex into never-fetched territory
    // that is exact on the first try. Measured rather than trusted because the
    // constants are the thing CSS drift would silently invalidate. Null until
    // the first row mounts, where the constant stands in.
    const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
    const measureFirstRow = useCallback((node: HTMLDivElement | null) => {
        // Also called with null when the ref detaches (the render after the
        // first measurement lands, since the ref is only attached while the
        // height is unknown).
        if (!node) return
        const height = node.getBoundingClientRect().height
        if (height > 0) {
            setMeasuredRowHeight((prev) => (prev === height ? prev : height))
        }
    }, [])
    // A breakpoint change is a different card height, so the measurement it
    // produced no longer describes anything: drop it and measure again rather
    // than scaling rows by a number taken at another size.
    useEffect(() => {
        if (!scroll) return
        setMeasuredRowHeight(null)
    }, [scroll, rowEstimate])
    // Published for the size slider (lib/state/gridMetricsBox.ts): the width
    // seeds its thumb (so the first drag off "auto" continues from what the
    // user is looking at); the container width is what lets it compute the
    // layout a candidate size WOULD produce; the column count and row pitch
    // are the page geometry its page-size co-write scales FROM (and what the
    // written page size must stay a multiple of); and the AUTO layout's pair,
    // published whatever mode this grid is in, is the geometry the "Use
    // automatic size" reset scales TO. The row pitch is the one the
    // virtualizer sizes rows with — the measured first row in scroll mode once
    // it has one, the estimate otherwise — which is why this sits after the
    // measurement it reads rather than up with the layout it describes. A box
    // write, so this costs the panel no render.
    const laidOutRowHeight = scroll ? measuredRowHeight ?? rowEstimate : rowEstimate
    useEffect(() => {
        metricsStore?.set({
            cellWidth: Math.round(cellWidth),
            columns,
            rowHeight: laidOutRowHeight,
            containerWidth: Math.round(containerWidth),
            autoColumns: autoLayout.columns,
            autoRowHeight: autoLayout.rowEstimate,
        })
    }, [
        metricsStore, cellWidth, columns, laidOutRowHeight, containerWidth,
        autoLayout.columns, autoLayout.rowEstimate,
    ])

    // KNOWN LIMIT, accepted for this release. Scroll mode gives the spacer div
    // below a real pixel height for the WHOLE result set, and browsers cap how
    // tall an element may be — ~33.5M px in Chrome, less in some engines. At the
    // row heights above (470/566/694px) that ceiling is somewhere around 50–70k
    // ROWS, i.e. a few hundred thousand items at typical column counts. Past it
    // the scroll space saturates: the offsets keep computing correctly but the
    // element stops growing, so the far end of the set is no longer reachable by
    // dragging. The scrubber still is — a virtual-page jump writes `top` and
    // rides scrollToIndex — so the set stays fully navigable; only the scrollbar
    // runs out of room. The fix, if it is ever wanted, is windowed offsets
    // (rebasing the spacer around the visible region), which is a different
    // sizing model and not worth carrying before a user meets the ceiling.
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => (scroll ? measuredRowHeight ?? rowEstimate : rowEstimate),
        overscan: GRID_OVERSCAN_ROWS,
    })

    // Record the scroll position continuously so it survives this component
    // unmounting while the gallery is open
    useEffect(() => {
        const element = parentRef.current
        if (!element || !savedScrollOffsetRef) return
        const onScroll = () => { savedScrollOffsetRef.current = element.scrollTop }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => element.removeEventListener('scroll', onScroll)
    }, [savedScrollOffsetRef])

    // ================= ANCHOR BOOKKEEPING: THE MAP =========================
    //
    // Ten pieces of state below answer versions of "where is the grid?", and
    // the failures they exist to prevent are all one piece speaking for
    // another's job. Read this before touching any of them.
    //
    // THE THREE ANCHOR NAMES, which are not synonyms:
    //   `scrollAnchor`      — the URL's answer. AUTHORITATIVE, shareable, and
    //                         layout-independent (an item index).
    //   `anchorItem`        — the grid's own working copy of the item it is
    //                         parked on, in the CURRENT layout. What the
    //                         re-assert effects divide by `columns`.
    //   `lastWrittenAnchor` — not a position at all: the echo filter. "The
    //                         last anchor value this component is accountable
    //                         for", so an arriving `scrollAnchor` equal to it
    //                         is our own write coming back through nuqs rather
    //                         than a back/forward or a query reset.
    //
    // EACH PIECE — single writer, then readers:
    //   `scrollAnchor`      W: the scroll-stop write, the stale-anchor drop,
    //                          and anything outside this component (history,
    //                          a mode switch, the scrubber).
    //                       R: the restore effect, the external-anchor effect,
    //                          the geometry layout effect, chunk warming.
    //   `anchorItem`        W: the tracker effect (steady state), the geometry
    //                          layout effect (re-base), the external-anchor
    //                          effect (the position it just scrolled to).
    //                       R: the column-change and row-height re-asserts,
    //                          restoreHasLanded.
    //   `lastWrittenAnchor` W: scroll-stop, restore, external-anchor, and the
    //                          geometry effect (which parks the SENTINEL).
    //                       R: scroll-stop and the external-anchor effect.
    //   `restorePending`    W: raised by the geometry layout effect, cleared
    //                          by the tracker once restoreHasLanded.
    //                       R: scroll-stop (say nothing) and the tracker
    //                          (read nothing). Nothing else.
    //   `prevColumns`       W+R: the column-change effect only — the tracker
    //                          reads it but must NOT rely on it (see there).
    //   `prevGeometry`      W+R: the geometry layout effect only.
    //   `restoredScroll`    W: the restore effect, once. R: the external-
    //                          anchor effect and chunk warming, as "the
    //                          restore has happened".
    //   `highlightedRow`    W+R: inside the scroll listener only — a closure
    //                          variable, deliberately not a ref, so the
    //                          scroll-stop reuses the SAME reading the
    //                          highlight came from rather than re-reading the
    //                          virtualizer 350ms later.
    //   `lastDerivedPage`   W+R: the scroll listener and the page-size relabel
    //                          effect. Makes the host fire on a page CROSSING
    //                          rather than per scroll frame.
    //   `listenerData`      W: a commit-time effect. R: the scroll listener
    //                          only — it exists so k and the counts can move
    //                          WITHOUT re-subscribing the listener (and
    //                          dropping its 350ms timer with it).
    //
    // THE RESTORE LIFECYCLE, in order:
    //   1. a layout change (scroll/columns/rowEstimate) is seen by the
    //      geometry LAYOUT effect. It re-bases `anchorItem` from the URL,
    //      parks `lastWrittenAnchor` on the sentinel, raises `restorePending`.
    //      It does not scroll.
    //   2. the window: scroll-stop writes nothing, the tracker reads nothing.
    //      Anything on screen belongs to the layout that has been left.
    //   3. someone scrolls the grid — the external-anchor effect (the anchor
    //      no longer matching the sentinel), or the column/row re-asserts.
    //   4. the tracker sees the reading agree with `anchorItem` (or the grid
    //      exhausted), clears `restorePending`, and resumes tracking.
    //
    // EFFECT DECLARATION ORDER IS LOAD-BEARING. React runs effects of one
    // commit in declaration order, so:
    //   - the geometry effect is a useLayoutEffect and must stay one: it has
    //     to raise `restorePending` before ANY `useEffect` of this commit,
    //     including the column-change effect that would otherwise re-assert a
    //     stale `anchorItem`.
    //   - the column-change effect must be declared BEFORE the tracker,
    //     because it updates `prevColumns` — which is precisely why the
    //     tracker's own `prevColumns` guard is already satisfied on the commit
    //     a column change lands, and why the flag rather than that guard is
    //     what closes the window.
    //   - the restore effect must be declared BEFORE the external-anchor
    //     effect: it sets `restoredScroll`, which the latter refuses to run
    //     without.
    // =======================================================================

    // URL scroll anchor: the first item of the topmost visible row, so the
    // position survives refreshes and can be shared (see useGridScrollAnchor)
    const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
    // Distinguishes our own anchor writes (which echo back through nuqs and
    // must be ignored) from external changes — back/forward navigation and
    // query-change resets — which have to move the actual scroll position
    const lastWrittenAnchor = useRef<number | null>(null)
    // Set while the grid's LAYOUT has changed under a position it has not been
    // put back on yet, and read by everything that would otherwise speak for
    // the position it is standing on meanwhile. Declared here, beside the
    // anchor state it guards; the effect that raises it and the reading that
    // clears it are below.
    const restorePending = useRef(false)

    // The last virtual page reported to the host, so the live position
    // indicator fires on a page CROSSING rather than on a scroll frame.
    const lastDerivedPage = useRef<number | null>(null)

    // Everything the scroll listener's scroll-mode branch needs that is NOT
    // allowed to re-subscribe it. k moves on a page-size commit, the counts on
    // every chunk that lands, and the listener owns a 350ms scroll-stop timer
    // that a re-subscription silently drops: a commit landing inside that
    // window would throw away a pending anchor write. Written after every
    // commit and read only from the listener — never during render.
    const listenerData = useRef({ pageSize, itemCount, rowCount })
    useEffect(() => {
        listenerData.current = { pageSize, itemCount, rowCount }
    })
    // Routing k through that ref means a page-size relabel no longer
    // re-subscribes the listener — so the suppression state has to be cleared
    // here instead. It records a page number under the OLD numbering, and left
    // standing it could swallow the first crossing under the new one while the
    // host is showing something else. (The columns case is covered by the
    // listener's own re-subscription; see its body.)
    //
    // And the relabel is REPORTED from here, which is why this effect is the
    // one that owns it. A page-size change renumbers the position the user is
    // already at and produces no scroll to announce it, so something has to
    // push; the grid is the only place that can push the RIGHT number, because
    // the highlight is derived from the top visible ROW (topRowHighlightItem)
    // and rows exist only inside the virtualizer. The host used to re-derive it
    // from the URL anchor on a k change — `floor(top / k) + 1` over an anchor
    // that speaks for the row's FIRST item — which lands a page low whenever
    // the row straddles a boundary, and stuck there until the next scroll. That
    // trigger now lives here and the host's effect no longer depends on k (see
    // MultiSearchView's derived page); two writers on the same commit would
    // have resolved parent-last, i.e. the wrong value winning.
    //
    // `virtualizer.range` is mutated internal state and legitimately null
    // before the first rows are laid out (a mount, an empty result set): there
    // is nothing to report from then, and `lastDerivedPage` is left cleared so
    // the first real scroll reports under the new numbering.
    useEffect(() => {
        lastDerivedPage.current = null
        if (!scroll || !onDerivedPageChange || columns <= 0) return
        const range = virtualizer.range
        if (range === null) return
        // Same expression as the scroll listener's, deliberately — the two
        // answers describe the same visible rows and may not disagree.
        const lastRowVisible = range.endIndex >= rowCount - 1
        const item = topRowHighlightItem(range.startIndex, columns, itemCount, lastRowVisible)
        const derived = virtualPageOf(item, pageSize)
        lastDerivedPage.current = derived
        onDerivedPageChange(derived)
        // pageSize ONLY: this is the relabel trigger, not a subscription to the
        // range. Every other value it reads moves the position by scrolling,
        // and the listener reports those itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize])

    // Persist the anchor only once scrolling pauses — never during a scroll,
    // so the URL write can't cost scroll frames (and browsers rate-limit
    // history.replaceState). While the top row is still (partially) visible
    // the param is removed entirely: short result sets and barely-scrolled
    // views keep a clean URL and today's behaviour.
    //
    // In scroll mode this same listener also drives the pagination bar's live
    // highlight — the ONLY live source of it (see MultiSearchView's derived
    // page). Same listener, and in scroll mode the same ROW: the stop write
    // takes the row the highlight last spoke for rather than reading the
    // virtualizer again 350ms later (see `highlightedRow` below, and the drift
    // that second reading produced).
    //
    // What they deliberately do NOT share is WHICH item of that row they speak
    // for. The anchor is the FIRST item — a position, and the codec's
    // documented contract (lib/state/gridScroll.ts) — while the highlight is
    // derived from the LAST item, because it answers a different question:
    // which virtual page am I looking at. See topRowHighlightItem for why the
    // two cannot be the same expression. The anchor written here is GLOBAL by
    // construction — the rows are global — so nothing about the write changes.
    useEffect(() => {
        const element = parentRef.current
        if (!element || columns <= 0) return
        // A columns change re-subscribes this, and the same top row then spans
        // a different set of items: a suppressed value from the old geometry
        // would eat the first crossing under the new one. (k is the other way
        // in — it does NOT re-subscribe, and is cleared by its own effect
        // above.)
        lastDerivedPage.current = null
        let timer: ReturnType<typeof setTimeout> | undefined
        // The row the live highlight last spoke for. In scroll mode the stop
        // write below takes its anchor from THIS, rather than reading the
        // virtualizer a second time — one row, two questions, never two rows.
        //
        // Two readings is a drift, not a rounding error. `scrollToIndex` lands
        // on a MEASURED row height and can finish a quarter of a pixel above
        // the row it aimed at, at which point the virtualizer's range honestly
        // reports the row ABOVE as the top one — while the highlight, derived
        // from the same range one event earlier, still speaks for the row
        // filling the viewport. The bar then shows page N while the URL records
        // page N-1, a mode switch commits the URL's answer, re-entering scroll
        // mode re-asserts the position one row higher, and the next switch does
        // it again: one page per round trip, without bound (56 -> 55 -> 54).
        //
        // Pages mode keeps the fresh read. It has no highlight for the anchor
        // to disagree with, and its rows are measured progressively as they
        // mount, so a reading taken when scrolling has actually stopped is the
        // more accurate one there.
        let highlightedRow: number | null = null
        const onScrollStop = () => {
            // The grid's layout has changed and it has not been put back on
            // the item the URL names yet (see the geometry-change effect
            // below). Whatever is on screen right now is the position the OLD
            // layout left, and publishing it would both lose the user's place
            // and mark the URL's own anchor as already-written — which stops
            // the restore that is on its way. Say nothing until it lands.
            if (restorePending.current) return
            const startRow = highlightedRow ?? virtualizer.range?.startIndex ?? 0
            const anchor = startRow > 0 ? startRow * columns : null
            if (anchor === lastWrittenAnchor.current) return
            lastWrittenAnchor.current = anchor
            setScrollAnchor(anchor)
        }
        const onScroll = () => {
            if (scroll && onDerivedPageChange) {
                const live = listenerData.current
                const range = virtualizer.range
                // At maximum scroll the last row is on screen and the top row
                // can go no further: the final virtual pages are reachable
                // only through this branch (see topRowHighlightItem).
                const lastRowVisible =
                    range !== null && range.endIndex >= live.rowCount - 1
                // Recorded even when the derived page is unchanged: what the
                // stop write needs is the row the bar is CURRENTLY speaking
                // for, not the one that last moved the number.
                highlightedRow = range?.startIndex ?? 0
                const item = topRowHighlightItem(
                    highlightedRow,
                    columns,
                    live.itemCount,
                    lastRowVisible
                )
                const derived = virtualPageOf(item, live.pageSize)
                if (derived !== lastDerivedPage.current) {
                    lastDerivedPage.current = derived
                    onDerivedPageChange(derived)
                }
            }
            clearTimeout(timer)
            timer = setTimeout(onScrollStop, 350)
        }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            clearTimeout(timer)
            element.removeEventListener('scroll', onScroll)
        }
    }, [columns, virtualizer, setScrollAnchor, scroll, onDerivedPageChange])

    // When the column count changes, rows recompose and the same pixel offset lands
    // on entirely different results: re-anchor the scroll to the item that was at the
    // top. Row heights don't depend on the column count, so existing row measurements
    // stay valid — don't reset them, or scrollToIndex would land on estimates instead.
    const prevColumns = useRef(columns)
    const anchorItem = useRef(0)
    useEffect(() => {
        if (prevColumns.current === columns) return
        prevColumns.current = columns
        if (anchorItem.current > 0) {
            virtualizer.scrollToIndex(Math.floor(anchorItem.current / columns), { align: 'start' })
        }
    }, [columns, virtualizer])

    /**
     * Has the pending restore finished moving the grid?
     *
     * AGREEMENT is the ordinary answer: the reading names the row the restore
     * aimed at, within the anchor's own row-quantization (hence the one-row
     * tolerance).
     *
     * EXHAUSTION is the other, and it is not an edge case: a target row inside
     * the last viewport-worth of rows cannot be brought to the TOP, and a
     * result set shorter than the viewport cannot be scrolled at all, so the
     * grid comes to rest above the target and agreement never arrives. Without
     * this the flag would stay raised for the rest of the session and the URL
     * would stop recording the scroll position entirely — a worse failure, and
     * a more frequent one, than the drift it exists to prevent.
     *
     * `resultsAreStale` and `countSettled` gate it, and that gate is the whole
     * reason exhaustion is safe: entering scroll mode the chunk store is empty,
     * so the scroll space is a stub the grid is trivially at the bottom of —
     * "there is nothing below me" then means "the rows have not arrived", not
     * "I have gone as far as I can". Waiting for a settled count and unstale
     * results is what tells those two apart.
     */
    const restoreHasLanded = (seen: number): boolean => {
        if (Math.abs(seen - anchorItem.current) <= columns) return true
        if (resultsAreStale || !countSettled) return false
        const element = parentRef.current
        if (!element) return false
        // Two pixels of slack for sub-pixel scroll offsets; `scrollHeight ===
        // clientHeight` (nothing to scroll) satisfies this too.
        return element.scrollTop + element.clientHeight >= element.scrollHeight - 2
    }

    // Track the first visible item while the layout is stable (runs on every
    // commit) — and, while a restore is outstanding, decide when it has LANDED.
    //
    // The two jobs are one effect because they are the same reading. What is on
    // screen during a restore window is the position the OLD layout left — in
    // the coordinate system the URL has left, after a mode switch; over the
    // wrong number of columns, after a resize or a size-slider commit — and
    // capturing it is not merely a stale number. The column-change effect ABOVE
    // and the row-height effect BELOW both re-assert `anchorItem`, on this
    // commit and on later ones, so a reading taken meanwhile drags the grid
    // straight back off the position the restore had just put it on, and the
    // scroll-stop then publishes THAT over the anchor in the URL.
    //
    // NOTE the guard this effect cannot rely on: `prevColumns` is owned by the
    // column-change effect above, which is declared FIRST and therefore updates
    // it before this runs. On the very commit a column change lands, this
    // effect's own guard is already satisfied while `virtualizer.range` still
    // describes the previous geometry — which is exactly how a slider commit in
    // scroll mode used to preserve the pixel offset instead of the item
    // (measured: shrinking cells 587 -> 270 moved top=260 to top=970, a
    // different item). The flag, raised in a LAYOUT effect before either of
    // them, is what actually closes that window.
    //
    // "Landed" is deliberately a reading, not an event, because
    // `virtualizer.range` LAGS a programmatic scroll by a commit: it is
    // recomputed from the scroll listener, so on the commit that issues
    // `scrollToIndex` it still describes where the grid was. Clearing the flag
    // when the restore was ISSUED therefore re-opens this tracker exactly one
    // commit too early, and it captures the old row — measured, and the reason
    // this test exists.
    useEffect(() => {
        if (prevColumns.current !== columns || !virtualizer.range) return
        const seen = virtualizer.range.startIndex * columns
        if (restorePending.current) {
            if (!restoreHasLanded(seen)) return
            restorePending.current = false
        }
        anchorItem.current = seen
    })

    // ANY LAYOUT CHANGE RE-BASES EVERY ITEM INDEX THIS COMPONENT HOLDS, and
    // `anchorItem` is one of them. Three inputs move it, and all three are
    // watched here:
    //
    //   - `scroll` — the coordinate system itself. The anchor is PAGE-LOCAL in
    //     pages mode and GLOBAL in scroll mode, so a page-local 25 left
    //     standing across a switch is re-asserted as a global 25.
    //   - `columns` — the divisor. The same item index names a different ROW
    //     under a different column count, and the re-assert effects only ever
    //     divide by the current one.
    //   - `rowEstimate` — the row height, which moves with a breakpoint and
    //     with every step of the size slider in explicit mode.
    //
    // In every case the failure is the same, and it is not merely a scroll
    // landing in the wrong place: a re-assert scrolls, the scroll starts the
    // listener's 350ms stop timer, and the stop write then PUBLISHES that stale
    // position over the anchor standing in the URL. Both halves are measured on
    // stdtest:
    //
    //   - MODE SWITCH (k=38, five columns, scroll top=260 -> pages page=7&top=25
    //     -> back): the URL held the correct `top=253` for 368ms and was then
    //     overwritten with `top=25`, dropping the pagination bar from page 7 to
    //     page 1. The switch arithmetic was right the whole time; this component
    //     was quoting the previous coordinate system over the top of it.
    //   - SIZE SLIDER in scroll mode (cells 587 -> 270): the batched write kept
    //     `top=260` correctly, and the grid then published `top=970` — a
    //     different item — having preserved the pixel offset instead of the
    //     item the anchor names. Which is the one thing an item-space anchor
    //     exists to prevent, in the mode the slider exists for.
    //
    // The URL anchor is authoritative for all of them, and it is already
    // correct: an item index does not depend on the layout, and where a mode
    // switch does change its meaning, the switch itself wrote it in the new
    // coordinates in the same URL update that flipped `vm` — so both arrive on
    // this commit. `lastWrittenAnchor` is parked on a value no anchor can take,
    // so the external-anchor effect below treats it as an arrival rather than as
    // an echo of one of our own writes and actually applies it — including the
    // `null` case (a restore that lands on the top of the set), where an echo
    // test on `null === null` would otherwise skip the scroll to the top.
    //
    // A LAYOUT effect: it must land before every `useEffect` in this commit,
    // which is exactly the set of effects that would otherwise re-assert the
    // stale value — including the column-change effect above, which updates the
    // `prevColumns` guard the tracker would otherwise have relied on.
    //
    // WHY IT DOES NOT SCROLL HERE, having tried: after a mode switch the new
    // mode's own results are not in hand on this commit. Entering scroll mode,
    // `itemCount` is the loaded extent of a chunk store with nothing in it, so
    // `rowCount` is a handful of rows and a `scrollToIndex` at the globalized
    // anchor clamps to the bottom of that stub. The places carrying the retry
    // discipline for this are the column-change effect above and the
    // external-anchor effect below — the latter re-runs on `itemCount`,
    // `countSettled` and `resultsAreStale` precisely so a position can land once
    // the results it names exist — so the restore stays there and this hands it
    // the job.
    //
    // What this does instead is HOLD THE GRID'S TONGUE until that lands.
    // `restorePending` suppresses the scroll-stop's anchor write and the
    // tracker's reading, and nothing else. Without it the 350ms timer fires
    // first, publishes the pre-change position, and — worse than the wrong
    // value — records it in `lastWrittenAnchor`, so the anchor in the URL then
    // reads as an echo of one of our own writes and the external-anchor effect
    // skips it forever. That is the whole failure: not one bad write, but a bad
    // write that closes the door on the good one.
    const prevGeometry = useRef({ scroll, columns, rowEstimate })
    useLayoutEffect(() => {
        const previous = prevGeometry.current
        if (previous.scroll === scroll && previous.columns === columns
            && previous.rowEstimate === rowEstimate) return
        prevGeometry.current = { scroll, columns, rowEstimate }
        // Re-based for the effects that re-assert it before the restore lands.
        // The tracker above stands down for the same window, so this value
        // survives to be re-asserted rather than being overwritten by a reading
        // of the position the old layout left.
        anchorItem.current = Math.max(scrollAnchor ?? 0, 0)
        lastWrittenAnchor.current = RESTORE_ANCHOR_SENTINEL
        restorePending.current = true
    }, [scroll, columns, rowEstimate, scrollAnchor])

    // Fixed rows mean ONE number decides every offset in the set, so a measured
    // height that differs from the breakpoint constant moves every row below
    // the first: re-derive the offsets, then put the item that was at the top
    // back at the top. This is what the pages-mode double-rAF re-assert (below)
    // is for there — but where that one waits out a progressive measurement it
    // cannot observe, this fires exactly once, on the commit that learns the
    // height, which is why the restore path can skip it in scroll mode.
    useEffect(() => {
        if (!scroll) return
        virtualizer.measure()
        if (anchorItem.current > 0 && columns > 0) {
            virtualizer.scrollToIndex(Math.floor(anchorItem.current / columns), { align: 'start' })
        }
    }, [scroll, measuredRowHeight, rowEstimate, columns, virtualizer])

    // When returning from the gallery: restore the exact scroll position from
    // before it opened — a quick look at one item must not shift the grid at all.
    // Then, as an invariant, the item selected in the gallery must be visible:
    // align 'auto' scrolls nothing when it already is, and scrolls the minimal
    // amount (nearest edge) when the gallery selection moved elsewhere or a
    // resize reflowed the grid while it was closed.
    const selected = useItemSelection((state) => state.getSelected())
    const restoredScroll = useRef(false)
    useEffect(() => {
        if (restoredScroll.current || rowCount === 0) return
        // Mounting onto results that aren't ours yet: closing the gallery
        // during a page-size remap lands here with the anchor already remapped
        // and the previous page still rendered. Restoring against it would
        // take the stale-anchor branch below and *delete* the position we just
        // computed. restoredScroll stays false, so this runs again on the
        // results it belongs to.
        if (resultsAreStale) return
        const savedOffset = savedScrollOffsetRef?.current ?? 0
        // Scroll mode before the count lands: `itemCount` is the loaded extent
        // and still growing, so an anchor past it is NOT the stale anchor the
        // branch below deletes — it is a position the scroll space has not
        // reached yet. On a cold load the results query is SSR-hydrated while
        // the count is still in flight, so this is the ordinary state of every
        // deep link, and deciding now would delete the position it arrived
        // with. Decide nothing: `itemCount` is a dependency, so this runs again
        // on the commit that learns the count.
        if (scroll && !countSettled && savedOffset <= 0
            && scrollAnchor !== null && scrollAnchor >= itemCount) {
            return
        }
        restoredScroll.current = true
        // From here on the current URL anchor is accounted for: the external-
        // change effect below must only react to values arriving later
        lastWrittenAnchor.current = scrollAnchor
        if (savedOffset > 0) {
            // Returning from the gallery: the exact pixel restore wins — the
            // URL anchor is just a coarser record of the same position
            virtualizer.scrollToOffset(savedOffset)
        } else if (scrollAnchor !== null && scrollAnchor > 0) {
            if (scrollAnchor < itemCount) {
                const anchorRow = Math.floor(scrollAnchor / columns)
                virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                // Unmeasured rows above the target make the first scroll land on
                // estimated offsets — re-assert once the rows around the target
                // have mounted and been measured
                //
                // Scroll mode has nothing to wait for: every row is the same
                // measured height, so the first scroll already lands on real
                // offsets, and a height correction (if the constant was wrong)
                // arrives as one event the measure effect above re-asserts
                // against. Re-asserting on a frame timer here would instead
                // race the user's own first scroll.
                if (!scroll) {
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                    }))
                }
            } else {
                // Stale anchor (e.g. a shared link into a result set that no
                // longer reaches that far) — drop it rather than landing
                // somewhere arbitrary
                lastWrittenAnchor.current = null
                setScrollAnchor(null)
            }
        }
        if (!selected) return
        // Pages mode scans the page, as it always has. Scroll mode scans only
        // the loaded neighbourhood of the position being restored — the whole
        // set is not scannable and this must not fetch — and skips when the
        // item isn't there; see findSelectedIndex.
        const anchorItemIndex = Math.max(scrollAnchor ?? 0, 0)
        const index = scroll
            ? findSelectedIndex(
                source,
                selected,
                Math.max(anchorItemIndex - SCROLL_CHUNK_SIZE, 0),
                Math.min(anchorItemIndex + SCROLL_CHUNK_SIZE, itemCount)
            )
            : findSelectedIndex(source, selected, 0, itemCount)
        if (index < 0) return
        const row = Math.floor(index / columns)
        // The visibility decision must use real DOM geometry: the virtualizer's own
        // align 'auto' reads its cached viewport rect, which is still zero-sized
        // right after mount (its ResizeObserver hasn't delivered yet) and turns
        // "ensure visible" into a bogus scroll. Row offsets are measurement-based
        // and safe to take from the virtualizer.
        const ensureVisible = () => {
            const element = parentRef.current
            if (!element) return
            const offsetForRow = virtualizer.getOffsetForIndex(row, 'start')
            if (!offsetForRow) return
            const rowStart = offsetForRow[0]
            const rowEnd = rowStart + (virtualizer.measurementsCache[row]?.size ?? rowEstimate)
            if (rowStart < element.scrollTop) {
                element.scrollTop = rowStart
            } else if (rowEnd > element.scrollTop + element.clientHeight) {
                element.scrollTop = rowEnd - element.clientHeight
            }
        }
        // Wait a frame so the restored offset has been applied, then once more
        // after the target rows have mounted and been measured
        requestAnimationFrame(() => {
            ensureVisible()
            requestAnimationFrame(ensureVisible)
        })
        // `source` is deliberately absent from the deps (it is minted per
        // render): `rowsIdentity` is the rows change signal, and it moves
        // whenever anything this body reads through `source` could have — so
        // the closure captured here is never stale on a run that matters.
    }, [rowCount, columns, rowsIdentity, itemCount, selected, virtualizer, savedScrollOffsetRef, rowEstimate, scrollAnchor, setScrollAnchor, resultsAreStale, scroll, countSettled])

    // Anchor values we didn't write ourselves arrive from history navigation
    // (back/forward restoring the entry's anchor) or from a query change
    // clearing it: move the grid to match. Our own scroll-stop writes echo
    // back as scrollAnchor === lastWrittenAnchor and are ignored, so plain
    // scrolling never re-enters here.
    // An anchor is only *applied* — and only then recorded as written — once it
    // has been applied against results it actually belongs to. A page-size
    // change can put an anchor beyond the end of the previous page, which
    // keepPreviousData is still rendering: clamping it to that shorter list
    // and marking it done would scroll to the wrong row and leave the correct
    // results unable to move the grid, since the effect would never re-fire.
    useEffect(() => {
        if (!restoredScroll.current) return
        if (scrollAnchor === lastWrittenAnchor.current) return
        if (columns <= 0 || rowCount === 0) return
        if (resultsAreStale) return
        // The same discipline for the same reason one step further out: while
        // the count is in flight the extent is not the end of the results, so
        // clamping a back/forward anchor into the loaded window — and recording
        // it as applied — would strand the user short of where the history
        // entry says they were, with no later commit able to correct it.
        if (scroll && !countSettled && scrollAnchor !== null && scrollAnchor >= itemCount) return
        lastWrittenAnchor.current = scrollAnchor
        // `anchorItem` is re-based to whatever this scrolls to, and that is
        // what stops the two records of "where the grid is" from fighting.
        // This effect moves the grid; the row-height and column-count effects
        // re-assert `anchorItem` on later commits of their own. Leaving it
        // holding the pre-restore reading makes the next of those re-asserts
        // undo this scroll — measured across a mode switch as a restore to
        // scrollTop 28300 followed by a snap back to 2828 — so the writer of
        // the position is also the writer of the record of it.
        if (scrollAnchor === null || scrollAnchor <= 0) {
            anchorItem.current = 0
            virtualizer.scrollToOffset(0)
        } else {
            const clamped = Math.min(scrollAnchor, itemCount - 1)
            anchorItem.current = clamped
            virtualizer.scrollToIndex(Math.floor(clamped / columns), { align: 'start' })
        }
    }, [scrollAnchor, columns, rowCount, itemCount, virtualizer, resultsAreStale, scroll, countSettled])

    // Fetch driving (scroll mode): warm the chunks behind the visible range
    // plus a margin, on every commit. No dependency array on purpose — the
    // same reasoning as the anchor tracker above: the virtualizer signals a
    // moved range by re-rendering, and its `range` is mutated internal state
    // that no dep list can name. `ensureRange` is cheap to call at that rate by
    // contract: an unchanged chunk set returns the previous state, so this
    // does not re-render the tree once a frame.
    //
    // On top of that, and until the restore has actually run, scroll mode also
    // warms around the URL ANCHOR. Not a fallback for a missing range — the
    // range exists from the first commit with rows in it, while the restore
    // waits for a settled count, which is strictly later — so a fallback would
    // never fire and the landing chunk would only be asked for once the
    // restore scroll had already happened: one full round trip of skeletons at
    // the destination of every deep link. Repeated on every commit until the
    // restore fires, which is what covers the anchor arriving late (a
    // back/forward entry) as well as the cold load.
    useEffect(() => {
        if (!scroll || columns <= 0) return
        // Stale rows mean the position has not been reset onto the new query
        // yet, so both the range and the anchor still describe the OLD one —
        // warming from them would spend one or two chunk requests at a
        // position under a search nobody is at. No dep array, so the commit
        // that clears the flag re-runs this and warming resumes at the reset
        // position.
        if (resultsAreStale) return
        const range = virtualizer.range
        const firstItem = range ? range.startIndex * columns : Math.max(scrollAnchor ?? 0, 0)
        const lastItem = range ? range.endIndex * columns + columns - 1 : firstItem
        const margin = overscanItemsFor(columns, GRID_OVERSCAN_ROWS)
        source.ensureRange(firstItem - margin, lastItem + margin)
        if (!restoredScroll.current) {
            const anchor = Math.max(scrollAnchor ?? 0, 0)
            source.ensureRange(anchor - margin, anchor + margin)
        }
    })

    return (
        <ScrollAreaPrimitive.Root className="relative overflow-hidden">
            <ScrollAreaPrimitive.Viewport
                ref={parentRef}
                // [&>div]:block! overrides the `display: table` on the content wrapper
                // Radix injects — table layout also sizes to content, which breaks the
                // width measurement the column count is derived from.
                // FIXED height, not max-h: the panel must keep its full size even
                // with few results, so the pagination below stays anchored to the
                // bottom and the viewport is pixel-identical to the pinboard tab
                // (and to the gallery pinboard with thumbnails off, which uses the
                // same 213/151 constants; the ribbon variants add its 48px).
                //
                // pr-4 pairs with the widened scrollbar below (design §10): the
                // thumb sits over the rightmost 16px of the Root, so without
                // this the cards' right edge runs underneath it. The padding
                // belongs on the VIEWPORT and not on the row container below —
                // rows are absolutely positioned, and an abs-positioned child
                // resolves `w-full` against its containing block's PADDING box,
                // so padding there would inset nothing.
                //
                // Explicit cell-size mode DOES derive its column count from a
                // width measurement, and this padding is why that measurement
                // is taken on the row container rather than on this viewport:
                // the spacer sits INSIDE the padding and has none of its own,
                // so what it reports is already the width the row's grid
                // resolves against (see the rowContainerRef comment above —
                // `clientWidth` on the viewport would have included these
                // 16px, `contentRect` would not, and the two disagreeing is
                // the trap). Auto mode derives nothing from it at all: its
                // columns come from window-level media queries
                // (useResultGridLayout). The row height — the one number
                // scroll mode's whole offset space is built on — is untouched
                // by horizontal padding either way.
                className={cn('w-full rounded-[inherit] [&>div]:block! pr-4',
                    showPagination
                        ? (updateRibbonVisible ? 'h-[calc(100vh-261px)]' : 'h-[calc(100vh-213px)]')
                        : (updateRibbonVisible ? 'h-[calc(100vh-199px)]' : 'h-[calc(100vh-151px)]')
                )}
            >
                <div
                    ref={rowContainerRef}
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const startIndex = virtualRow.index * columns
                        return (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                // Pages mode measures every row as it mounts.
                                // Scroll mode attaches its one-shot measurement
                                // instead, and only until it has an answer —
                                // after that no row carries a ref at all, so
                                // scrolling costs no layout reads.
                                ref={scroll
                                    ? (measuredRowHeight === null ? measureFirstRow : undefined)
                                    : virtualizer.measureElement}
                                className="absolute top-0 left-0 w-full"
                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                            >
                                <div
                                    // AUTO: the responsive classes, which must
                                    // stay in sync with useResultGridLayout.
                                    // EXPLICIT: the column count computed from
                                    // the slider's target width, plus the gap
                                    // spelled out in pixels — the same number
                                    // `columnsForCellWidth` measured against,
                                    // so the two cannot drift the way a `rem`
                                    // gap would under a raised root font size.
                                    className={cn('grid pb-4',
                                        explicitSize
                                            ? ''
                                            : cn('gap-4 grid-cols-1 md:grid-cols-2',
                                                sidebarOpen ?
                                                    ('lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5') :
                                                    ('lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'))
                                    )}
                                    style={explicitSize ? {
                                        gap: `${GRID_GAP_PX}px`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                    } : undefined}
                                >
                                    {/* Cells are addressed by global index and
                                        capped at the item count, so the last
                                        row is short in exactly the way slicing
                                        the page's array used to make it. An
                                        index below the count with no row yet is
                                        the scroll-mode "chunk in flight" case
                                        and renders a skeleton; in pages mode
                                        the source always has the row, so that
                                        branch is unreachable there.

                                        KNOWN LIMIT, accepted: a chunk that has
                                        given up (ResultsSource.errorAt) also
                                        renders as skeletons here, with no retry
                                        affordance — the gallery has one because
                                        it is showing a single item the user
                                        asked for, while a grid row is one of
                                        many and a per-cell retry button would
                                        be a wall of them. Recovery in the grid
                                        is a window focus or reconnect refetch,
                                        or scrolling far enough away for the
                                        chunk to leave the observed set
                                        (MAX_WANTED_CHUNKS) and coming back, so
                                        a fresh observer re-arms the query. */}
                                    {Array.from({ length: columns }, (_, indexInRow) => {
                                        const index = startIndex + indexInRow
                                        if (index >= itemCount) return null
                                        const result = source.get(index)
                                        if (!result) {
                                            return <ResultCellSkeleton key={`pending-${index}`} imageHeightPx={imageHeightPx} />
                                        }
                                        return (
                                            <SearchResultImage
                                                key={result.file_id}
                                                result={result}
                                                index={index}
                                                dbs={dbs}
                                                onImageClick={handleImageClick}
                                                // Every card in the set opens
                                                // the gallery, in both modes:
                                                // `gi` is a global index and
                                                // the gallery resolves it
                                                // against this same source.
                                                galleryLink
                                                showLoadingSpinner={isLoading}
                                                // THE BOX, not a tier: three
                                                // stable primitives the card
                                                // turns into its own rendition
                                                // choice, because that depends
                                                // on the row (see the box
                                                // above, and `cellTier` in the
                                                // card). React.memo still
                                                // holds — they move only when
                                                // the layout does.
                                                cellWidth={cellWidth}
                                                boxHeightPx={imageBoxHeight}
                                                dpr={dpr}
                                                // The height as a STYLE, which
                                                // only the explicit mode sets:
                                                // absent leaves the breakpoint
                                                // classes standing.
                                                imageHeightPx={imageHeightPx}
                                                // Same rule as the box: read
                                                // ONCE for the whole grid and
                                                // handed down, never a hook
                                                // per card. react-query keeps
                                                // the object's identity across
                                                // renders that change nothing,
                                                // so the memo still holds.
                                                animatedFloor={animatedFloor}
                                                // The third of the same kind,
                                                // out of the same query and
                                                // therefore with the same
                                                // stable identity.
                                                displayLoopTrigger={displayLoopTrigger}
                                                // One more stable primitive
                                                // on the same rule as the box:
                                                // it moves only when the cell
                                                // crosses the small threshold
                                                // or the user changes the
                                                // preference.
                                                animateMode={animateMode}
                                                // The last of the same kind:
                                                // one interned constant for
                                                // the whole grid, moving only
                                                // when the answer does.
                                                hoverPreview={hoverPreview}
                                                // One more stable primitive,
                                                // moving only when the user
                                                // changes the setting.
                                                previewTrigger={previewTrigger}
                                                // And the last: the outro
                                                // preference, one boolean for
                                                // the whole grid.
                                                outroSkip={outroSkip}
                                            />
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </ScrollAreaPrimitive.Viewport>
            {/* Wider and higher-contrast than the shared default, at THIS call
                site only (design §10): the results grid is the one surface in
                the app that is dragged across tens of thousands of rows, where
                a 10px `bg-border` thumb — a token that is nearly the background
                in the light theme — is both hard to see and hard to grab. The
                component itself has ~15 other consumers and stays untouched;
                everything here goes through `className`, which twMerge resolves
                against the defaults (w-4 replaces w-2.5, the `p-px` inset and
                the thumb's `rounded-full` survive, so the thumb is 13px inside
                a 16px grab track). The thumb is the scrollbar's only child, so
                `[&>div]` addresses it; the hover selector is written as
                `[&:hover>div]` rather than a stacked `hover:` variant so the
                generated rule is unambiguous — hovering anywhere on the track
                darkens the thumb. Theme tokens, not literals: muted-foreground
                is defined for both themes (app/globals.css). */}
            <ScrollBar
                orientation="vertical"
                className="w-4 [&>div]:bg-muted-foreground/60 [&>div]:transition-colors [&:hover>div]:bg-muted-foreground/90"
            />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}
