'use client'

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { useSearchParams } from 'next/navigation'
import { BookmarkBtn, FileActionCluster } from "@/components/imageButtons"
import { ScrollBar } from "@/components/ui/scroll-area"
import { cn, getFileURL } from "@/lib/utils"
import { useGalleryIndex, getGalleryOptionsSerializer } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useItemSelection } from "@/lib/state/itemSelection"
import { PinButton } from './PinButton'
import { FindButton } from './FindButton'
import { blurHashToDataURL } from '@/lib/state/blurHashDataURL'
import { useSearchLoading } from '@/lib/state/zust'
import { topRowHighlightItem, virtualPageOf } from '@/lib/scrollMode'
import type { ResultsSource } from '@/lib/searchHooks'

// How far past the rendered cards the strip warms rows, in items. The strip
// renders about a screen's worth of 256px cards at a time, so a couple of
// screens of margin is what keeps a flick from landing on skeletons; the warm
// itself is chunk-granular, so anything in this range costs the same one or
// two chunks (see ResultsSource.ensureRange).
const STRIP_WARM_MARGIN = 32

// Where a gallery index lands in a strip of `count` cards. One expression, two
// readers — the scroll-into-view target and each card's own selected test —
// because a card that disagrees with the scroll would highlight one item while
// the strip centres another.
function clampToCount(index: number | null, count: number): number {
    return Math.max(0, Math.min(index || 0, count - 1))
}

export function VirtualGalleryHorizontalScroll({
    source,
    count,
    onNavigate,
    fallbackAnchor = null,
    onDerivedPageChange,
    pageSize = 0,
    onItemHover,
}: {
    /**
     * The same rows the gallery reads: the page's array in pages mode, a
     * sparse window over the whole result set in scroll mode. The strip spans
     * the whole set, not the loaded part of it, so its geometry (a fixed 256px
     * per card, which is exact) never rescales as chunks land — and renders a
     * skeleton card wherever a row is not loaded yet.
     */
    source: ResultsSource
    /**
     * The navigable extent, taken from the HOST rather than read off
     * `source.count` here. The gallery passes its own count — the loaded
     * extent widened to include the position the URL names while the count
     * query is still in flight (see its `countSettled` handling): resolving
     * `gi` against the narrower value would put the strip's selected card
     * somewhere else entirely, and two surfaces disagreeing about how far the
     * set reaches is a wrong item on one of them. The maximized search
     * overlay passes MultiSearchView's `itemCount` (= `source.count`),
     * accepting the pre-settle clamp for that transient window.
     */
    count: number
    /**
     * Where a card click sends the gallery. The GALLERY's own position write,
     * not a bare `setIndex`: in scroll mode it carries the grid's scroll anchor
     * along with `gi`, which is what makes a strip-driven jump across the set
     * survive closing the gallery (see useGalleryNavigate — both mounts). The
     * `href` on each card is unaffected — a real navigation re-mounts against
     * the URL it names.
     */
    onNavigate: (index: number) => void
    /**
     * Where the strip should sit while NO item is selected (`gi` null): the
     * grid's scroll anchor, passed by the maximized board's search overlay
     * (docs/maximized-pinboard-search-overlay-design.md §5.3). There a
     * scrubber click with nothing selected writes only `top` —
     * `setVirtualPage` deliberately keeps `gi` null while the gallery is
     * closed — and without this the strip would not move. The gallery passes
     * nothing and keeps exact current behavior: `gi` wins whenever it is set
     * (`??`, so index 0 is still an address, not an absence).
     */
    fallbackAnchor?: number | null
    /**
     * The live position indicator (design §6): called with the virtual page
     * of the leading visible card, and ONLY when that number changes, so
     * panning doesn't re-render the host per frame. Must be referentially
     * stable — it is a dependency of the scroll listener below (both mounts
     * pass a useState setter). Comes with `pageSize`.
     */
    onDerivedPageChange?: (page: number) => void
    /** k, the virtual-page size, for the derived page number. */
    pageSize?: number
    /**
     * Hover reporting for the maximized search overlay's centered preview
     * (docs/maximized-pinboard-search-overlay-design.md §8): the row on card
     * mouseenter, null on mouseleave — and null again on a card's own
     * dragstart, part of the same contract, because the preview portals at
     * z-70 and would visually occlude a drag toward the board (§8). Only
     * LOADED cards report: a skeleton has no row to preview. The gallery
     * mount passes nothing and is unaffected.
     */
    onItemHover?: (item: SearchResult | null, index: number) => void
}) {
    "use no memo"
    const parentRef = useRef<HTMLDivElement>(null)

    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 256,
        horizontal: true,
    })

    // Map vertical wheel to horizontal scroll, but leave real horizontal
    // wheel input (trackpads, tilt wheels) to the browser.
    const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!parentRef.current || e.deltaY === 0 || e.deltaX !== 0) {
            return
        }
        const { scrollLeft, scrollWidth, clientWidth } = parentRef.current
        parentRef.current.scrollLeft = Math.max(
            0,
            Math.min(scrollWidth - clientWidth, scrollLeft + e.deltaY)
        )
    }, [])
    const [qIndex] = useGalleryIndex()
    // The item the strip must keep in view, and WHICH FILE is currently at it.
    // The second half is the re-assert trigger, and it is deliberately not
    // `rowsIdentity`:
    //
    //   - a page turn can land on the same `gi` with a completely different
    //     page under it, and the strip must scroll back rather than stay where
    //     the previous page left it — the file at the index changes, so it
    //     does (this is what the old `items` dependency bought);
    //   - in scroll mode `rowsIdentity` ALSO moves on every chunk that lands,
    //     including one the user's own drag of the strip just warmed. Keying
    //     the re-assert on that would snap the strip back to the current item
    //     the moment it crossed a chunk seam — undraggable past the loaded
    //     window. The file at `gi` does not move when a chunk lands elsewhere,
    //     so this trigger is silent for it;
    //   - and when the current item's OWN chunk lands (a cold deep link, where
    //     it was undefined until then) the file at the index changes from
    //     nothing to something, which is exactly when the strip should centre
    //     itself for the first time.
    //
    // Narrowing the trigger from `items` to these three is an intentional
    // PAGES-MODE delta as well: a rows change that leaves the same file at
    // `gi` — a bookmark patch rewriting the results object — no longer snaps a
    // strip the user has scrolled away back to the current item.
    //
    // CLAMPED, never wrapped, exactly as the gallery clamps `gi`: past the end
    // of the set is not an address, and the modulo this used to be would map a
    // deep `gi` onto an unrelated card near the front while the count is still
    // in flight. Clamping holds it at the strip's loading edge instead, which
    // is where the item will be once the extent catches up.
    //
    // `gi` wins over the fallback whenever it is set — the fallback exists
    // only for the overlay's no-selection state (see the prop).
    const stripTarget = count > 0 ? clampToCount(qIndex ?? fallbackAnchor, count) : 0
    const fileAtTarget = source.get(stripTarget)?.file_id
    // Keep the selected thumbnail in view as the gallery index moves — the
    // ← / → keys of the gallery keyboard scope (GalleryImageLarge), the
    // click-through halves of the large image, the header arrows and
    // pagination all land here.
    //
    // The scroll this issues is PROGRAMMATIC, and the live listener below
    // must not derive a highlight from it: a programmatic scroll is
    // anchor/selection-driven, and for those the anchor itself is the
    // authoritative highlight source (useDerivedVirtualPage's anchor-trigger
    // branch — exact, item-addressed). Deriving from the leading visible
    // card is only valid for USER pans, because scrollToIndex's default
    // 'auto' alignment resolves to 'end' on a forward jump: the target card
    // lands at the RIGHT edge, the leading card belongs to the PREVIOUS
    // virtual page, and the listener would push N−1 for a jump to N. (Not
    // fixed with align:'start' — that would change the gallery's
    // minimal-scroll stepping into a full re-seat per step.)
    const programmaticScrollRef = useRef(false)
    useEffect(() => {
        if (count === 0) return
        programmaticScrollRef.current = true
        virtualizer.scrollToIndex(stripTarget)
        // Clear on the next frame, not in the listener alone: when the
        // target is ALREADY in view scrollToIndex moves nothing and NO
        // scroll event ever fires, so a listener-only clear would leave the
        // flag stuck — eating the first crossing of the next real user pan.
        // Ordering is safe for the case where a scroll DOES happen: the
        // browser runs scroll steps before animation-frame callbacks in the
        // same rendering update, so the listener consumes the flag first.
        requestAnimationFrame(() => {
            programmaticScrollRef.current = false
        })
    }, [stripTarget, fileAtTarget, count, virtualizer])

    // ---- live scrubber tracking (design §6): the strip-side mirror of
    // ResultGrid's scroll listener, so the pagination bar's highlight follows
    // a strip PAN the way it follows a grid scroll.
    //
    // The last page reported, so the push fires on a page CROSSING rather
    // than on every scroll frame — the host re-renders on each push.
    const lastDerivedPage = useRef<number | null>(null)
    // What the listener reads that must not re-subscribe it: `count` moves on
    // every chunk that lands and `pageSize` on a relabel, and neither changes
    // WHERE the strip is. The grid routes the same values through a ref to
    // protect a 350ms scroll-stop timer; this listener owns no timer, but
    // re-subscribing per chunk landing would still be churn with nothing
    // bought. Written after every commit, read only from the handler.
    const listenerData = useRef({ count, pageSize })
    useEffect(() => {
        listenerData.current = { count, pageSize }
    })
    // HIGHLIGHT ONLY — this listener writes NOTHING to the URL (no `top`, no
    // `gi`). In gallery/overlay mode the anchor is owned by selection ("the
    // anchor follows the position", useGalleryNavigate); giving strip pans an
    // anchor write would create two owners for one coordinate, the exact bug
    // class scroll mode is defined to avoid (design §6). A pan is therefore
    // visual-only, and a refresh re-centres on the selection — consistent
    // with selection being the durable coordinate.
    //
    // topRowHighlightItem with columns = 1: the strip IS a one-column grid
    // rotated, so the leading visible card is both the first and last item of
    // its "row" and the grid's row-vs-item distinction collapses. The
    // end-clamp branch is the horizontal analog of the grid's lastRowVisible:
    // once the LAST card is on screen no further scroll can move the leading
    // one, so the final virtual pages are reachable only by letting the last
    // item speak (asserted for this geometry in scripts/scrollmode.test.mjs).
    //
    // The keep-in-view programmatic scrollToIndex above fires this same
    // listener, and the listener STANDS DOWN for it (programmaticScrollRef):
    // the anchor that caused the scroll is the authoritative highlight
    // source there, via the host's anchor-triggered derivation
    // (useDerivedVirtualPage), and the leading card after an 'auto'-aligned
    // forward jump sits on the previous page — deriving from it would
    // overwrite the anchor's exact page with N−1.
    useEffect(() => {
        const element = parentRef.current
        if (!element || !onDerivedPageChange) return
        // A re-subscription is a new reporting epoch: leave the dedupe
        // cleared so the first crossing under it is reported.
        lastDerivedPage.current = null
        const onScroll = () => {
            // A programmatic keep-in-view scroll: consume the flag and stand
            // down — the anchor is the highlight source for those (see the
            // flag's comment above).
            if (programmaticScrollRef.current) {
                programmaticScrollRef.current = false
                return
            }
            const live = listenerData.current
            const range = virtualizer.range
            const lastItemVisible =
                range !== null && range.endIndex >= live.count - 1
            const item = topRowHighlightItem(
                range?.startIndex ?? 0,
                1,
                live.count,
                lastItemVisible
            )
            const derived = virtualPageOf(item, live.pageSize)
            if (derived !== lastDerivedPage.current) {
                lastDerivedPage.current = derived
                onDerivedPageChange(derived)
            }
        }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => element.removeEventListener('scroll', onScroll)
    }, [virtualizer, onDerivedPageChange])

    // Warm the rows the strip is showing, the same way the result grid warms
    // the rows it is showing: without it a scroll-mode strip dragged past the
    // loaded window would be a field of skeletons that never fills. No
    // dependency array on purpose — the virtualizer signals a moved range by
    // re-rendering, and its `range` is mutated internal state no dep list can
    // name — and cheap to call at that rate by contract: an unchanged chunk
    // set returns the previous state, so this does not re-render the tree once
    // a frame. A no-op in pages mode, where ensureRange is empty.
    useEffect(() => {
        const range = virtualizer.range
        if (!range) return
        source.ensureRange(
            range.startIndex - STRIP_WARM_MARGIN,
            range.endIndex + STRIP_WARM_MARGIN,
        )
    })

    return (
        <ScrollAreaPrimitive.Root
            onWheel={onWheel}
            className="relative overflow-hidden w-full whitespace-nowrap rounded-md border"
        >
            <ScrollAreaPrimitive.Viewport
                ref={parentRef}
                className="h-full w-full rounded-[inherit]"
            >
                <div
                    className="flex h-88"
                    style={{
                        width: `${virtualizer.getTotalSize()}px`,
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const style = {
                            position: 'absolute' as const,
                            top: 0,
                            left: 0,
                            width: `${virtualItem.size}px`,
                            transform: `translateX(${virtualItem.start}px)`,
                        }
                        const item = source.get(virtualItem.index)
                        // Not loaded: a card-shaped placeholder, never an
                        // end-of-results marker — the strip only renders
                        // indices below the known count, and `undefined` there
                        // means "its chunk is in flight or has not been asked
                        // for" (see ResultsSource.get). Unreachable in pages
                        // mode, where the source always has the row.
                        if (!item) {
                            return <HorizontalScrollSkeleton
                                key={`pending-${virtualItem.index}`}
                                style={style}
                            />
                        }
                        return (
                            <VirtualHorizontalScrollElement
                                key={item.file_id}
                                item={item}
                                ownIndex={virtualItem.index}
                                nItems={count}
                                style={style}
                                onNavigate={onNavigate}
                                onItemHover={onItemHover}
                            />
                        )
                    })}
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}

// The strip's thumbnail frame with nothing in it yet. EVERY class is copied
// from the loaded card below — the outer 240px/16px padding box and the
// w-[240px] h-80 figure — because the card's footprint is what makes the
// virtualizer's fixed 256px estimate exact, and a skeleton of another size
// would put the strip's geometry a few pixels out per unloaded card. `bg-muted`
// rather than the shared Skeleton primitive, whose bg-slate-100 is a
// light-mode-only value (same call as ResultCellSkeleton's).
//
// Deliberately bare of the loaded card's overlay verbs — bookmark, pin, find
// and the FileActionCluster all address a FILE, and this card has no row to
// name one: every one of them needs `item.sha256` at least. The cluster in
// particular would also mount a useFileShare per unloaded card. The verbs
// appear with the row, which is the same moment the picture does.
function HorizontalScrollSkeleton({ style }: { style: React.CSSProperties }) {
    return (
        <div
            aria-hidden="true"
            style={{ ...style, width: '240px', padding: '16px' }}
        >
            <div className="w-[240px] h-80 relative rounded-md animate-pulse bg-muted" />
        </div>
    )
}

function VirtualHorizontalScrollElement({
    item,
    ownIndex,
    nItems,
    style,
    onNavigate,
    onItemHover,
}: {
    item: SearchResult
    ownIndex: number
    nItems: number
    style: React.CSSProperties
    /** The gallery's position write — see the strip's own prop. */
    onNavigate: (index: number) => void
    /** Hover reporting for the overlay preview — see the strip's own prop. */
    onItemHover?: (item: SearchResult | null, index: number) => void
}) {
    const [qIndex] = useGalleryIndex()
    // The same mapping the strip scrolls to (see stripTarget): clamped, not
    // wrapped, or the ring would land on a different card than the one the
    // strip centres. `gi` null is NO selection and no ring — reachable only
    // in the overlay mount (the gallery never shows the strip without `gi`),
    // where the strip follows `fallbackAnchor`, a position rather than a
    // selection, and ringing card 0 for it would invent a selection that
    // does not exist.
    const isSelected = useMemo(
        () => qIndex !== null && nItems > 0 && ownIndex === clampToCount(qIndex, nItems),
        [qIndex, nItems, ownIndex]
    )
    const [dbs] = useSelectedDBs()
    const setSelected = useItemSelection((state) => state.setItem)
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const params = useSearchParams()

    const imageLink = useMemo(() => {
        const queryParams = new URLSearchParams(params)
        const indexUrl = getGalleryOptionsSerializer()(queryParams, { gi: ownIndex % nItems })
        return indexUrl
    }, [ownIndex, params, nItems])

    const onClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
        e.preventDefault()
        onNavigate(ownIndex % nItems)
        setSelected(item)
    }
    const blurDataURL = useMemo(() => item.blurhash ? blurHashToDataURL(item.blurhash) : undefined, [item.blurhash])
    const searchLoading = useSearchLoading(state => state.loading)
    const handleDragStart = (event: React.DragEvent<HTMLImageElement | HTMLAnchorElement | HTMLDivElement>): void => {
        if (!item) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', item.sha256);
        event.dataTransfer.setData('text/uri-list', getFileURL(dbs, "file", "sha256", item.sha256));
        // The hovered card is by definition the drag source, so clear the
        // overlay's hover preview: it portals at z-70 and would sit over the
        // board exactly where the drag is headed (design §8). mouseleave is
        // not reliable mid-HTML5-drag, hence the explicit clear here.
        onItemHover?.(null, ownIndex);
    }
    return (
        <div
            style={{
                ...style,
                width: '240px',
                padding: '16px',
            }}
        >
            <figure
                className={cn(
                    "w-[240px] h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-hidden cursor-pointer group",
                    isSelected ? "scale-105 ring-2 ring-blue-500" : "scale-100"
                )}
                onDragStart={handleDragStart}
                draggable={true}
                onMouseEnter={() => onItemHover?.(item, ownIndex)}
                onMouseLeave={() => onItemHover?.(null, ownIndex)}
            >
                <Link href={imageLink} onClick={onClick}>
                    <div className="w-full h-full relative">
                        <Image
                            src={thumbnailURL}
                            alt={item.path}
                            className="object-cover object-top rounded-md cursor-pointer"
                            fill
                            placeholder={blurDataURL ? 'blur' : 'empty'}
                            blurDataURL={blurDataURL}
                            unoptimized={true}
                            sizes="240px"
                        />
                    </div>
                </Link>
                {searchLoading && (
                    <div className="absolute inset-0 z-10 flex items-center rounded-md justify-center bg-white bg-opacity-50">
                        <Image
                            src="/spinner.svg"
                            alt="Loading..."
                            width={110}
                            height={110}
                        />
                    </div>
                )}
                <BookmarkBtn sha256={item.sha256} bookmarked={item.bookmarked} />
                <PinButton sha256={item.sha256} />
                <FindButton
                    id={item.file_id}
                    id_type='file_id'
                    path={item.path}
                />
                {/* The one corner (bottom-right) the pin/bookmark/find trio
                    leaves free; expands leftward and upward over the image. */}
                <FileActionCluster sha256={item.sha256} path={item.path} anchor="bottom-right" />
            </figure>
        </div>
    )
}