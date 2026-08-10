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
     * The navigable extent, taken from the GALLERY rather than read off
     * `source.count` here. The two differ while the count query is still in
     * flight: the source's answer is then the loaded extent, and the gallery's
     * is that extent widened to include the position the URL names (see its
     * `countSettled` handling). Resolving `gi` against the narrower one would
     * put the strip's selected card somewhere else entirely — two surfaces
     * disagreeing about how far the set reaches is a wrong item on one of them.
     */
    count: number
    /**
     * Where a card click sends the gallery. The GALLERY's own position write,
     * not a bare `setIndex`: in scroll mode it carries the grid's scroll anchor
     * along with `gi`, which is what makes a strip-driven jump across the set
     * survive closing the gallery (see `navigateTo` in ImageGallery). The
     * `href` on each card is unaffected — a real navigation re-mounts against
     * the URL it names.
     */
    onNavigate: (index: number) => void
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
    const stripTarget = count > 0 ? clampToCount(qIndex, count) : 0
    const fileAtTarget = source.get(stripTarget)?.file_id
    // Keep the selected thumbnail in view as the gallery index moves — the
    // ← / → keys of the gallery keyboard scope (GalleryImageLarge), the
    // click-through halves of the large image, the header arrows and
    // pagination all land here.
    useEffect(() => {
        if (count === 0) return
        virtualizer.scrollToIndex(stripTarget)
    }, [stripTarget, fileAtTarget, count, virtualizer])

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
}: {
    item: SearchResult
    ownIndex: number
    nItems: number
    style: React.CSSProperties
    /** The gallery's position write — see the strip's own prop. */
    onNavigate: (index: number) => void
}) {
    const [qIndex] = useGalleryIndex()
    // The same mapping the strip scrolls to (see stripTarget): clamped, not
    // wrapped, or the ring would land on a different card than the one the
    // strip centres.
    const isSelected = useMemo(
        () => nItems > 0 && ownIndex === clampToCount(qIndex, nItems),
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