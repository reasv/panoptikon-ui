'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Expand, Shrink } from 'lucide-react'
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { useSearchParams } from 'next/navigation'
import { BookmarkBtn, FileActionCluster } from "@/components/imageButtons"
import { ScrollBar } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { originalFileURL, thumbnailMediaURL, thumbnailPictureURL } from "@/lib/thumbnailURL"
import { useGalleryIndex, getGalleryOptionsSerializer } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useItemSelection } from "@/lib/state/itemSelection"
import { PinButton } from './PinButton'
import { FindButton } from './FindButton'
import { blurHashToDataURL, type PlaceholderDataURL } from '@/lib/state/blurHashDataURL'
import { LoopVideo } from '@/components/LoopVideo'
import { PlayableBadge } from '@/components/PlayableBadge'
import { useSearchLoading } from '@/lib/state/zust'
import { topRowHighlightItem, virtualPageOf } from '@/lib/scrollMode'
import {
    animatedCellMode,
    showsMotionBadge,
    tierForCellWidth,
    type AnimatedFloor,
    type ThumbnailTier,
} from '@/lib/thumbnailTier'
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio'
import { CELL_HOVER_ROOT_ATTR, useArmedHover } from '@/hooks/useArmedHover'
import { trackHoverPointer } from '@/lib/state/animatedPlayback'
import { useAnimatedFloor } from '@/lib/useClientConfig'
import type { ResultsSource } from '@/lib/searchHooks'

// The BINDING EDGE of the strip's card box, in CSS pixels: the LARGER of the
// `w-[240px] h-80` figure below — its 320px height.
//
// The larger edge, not the width, and that is a rule rather than a detail
// here. The card paints `object-cover`, which scales the rendition until it
// covers BOTH edges, so crispness is bound by whichever edge asks more of the
// image. Sizing from the 240px width would request `grid-s` at a device pixel
// ratio of 2 (480 device px, comfortably inside the 512 tier) for a box that
// actually needs 640 — a 1.25x upscale, past the ladder's 1.125 slack. The
// argument handed to `tierForCellWidth` is therefore always the edge that
// binds; the result grid's cells are square, so its two edges agree and only
// this surface has to say so out loud.
//
// The strip was the single worst offender before tiers existed: it loaded
// display-class renditions (4096px on the long side, or the original file)
// into this box, one per card, at virtualized-remount rates.
const STRIP_CARD_CSS_BINDING_EDGE = 320

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
    viewerOpen,
    onViewerOpenChange,
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
     * pass the derived-page box's `set`, minted once per mount). Comes with
     * `pageSize`.
     */
    onDerivedPageChange?: (page: number) => void
    /** k, the virtual-page size, for the derived page number. */
    pageSize?: number
    /**
     * Hover reporting for the maximized search overlay's preview surface
     * (docs/maximized-pinboard-search-overlay-design.md §8): the row while
     * the pointer is on the card's peek trigger, null when it leaves — and
     * null again on a card's own dragstart, part of the same contract,
     * because the surface sits over the board and would visually occlude a
     * drag toward it (§8).
     *
     * WHICH part of the card is that trigger is asymmetric between the two
     * viewer states, deliberately (§8.1). Viewer CLOSED: the preview button
     * only, because an unconditional body-hover takeover covers the board
     * exactly when the user is reaching across it to drop something, which
     * is the whole reason the button exists. Viewer OPEN: the card BODY as
     * well — the takeover already happened and the surface is up, so making
     * the user find a small target per item is friction for no protection,
     * and it matches the click semantics they already have (clicking a body
     * fixes that item; hovering one showing it temporarily is the same
     * gesture, weaker).
     *
     * Only LOADED cards report: a skeleton has no row to preview. Passing
     * this prop is also what puts the button on the card at all — the
     * gallery mount passes nothing, gets no button, and is unaffected.
     */
    onItemHover?: (item: SearchResult | null, index: number) => void
    /**
     * Whether the maximized board's pinned viewer is open
     * (docs/maximized-pinboard-search-overlay-design.md §8.1). WHICH item it
     * holds is not a second piece of state: by §8's identity rule the viewer
     * always shows the selected item, so "the viewer is on this card" is
     * exactly `viewerOpen && isSelected`. It decides the preview button's
     * glyph and what its click does — open, close, or swap — and, per §8.1's
     * trigger asymmetry, whether the card BODY peeks as well as the button.
     */
    viewerOpen?: boolean
    /** Open/close the viewer — the other half of the button's click (§8.1). */
    onViewerOpenChange?: (open: boolean) => void
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
    // ONE tier for the whole strip, computed here and passed down: the card
    // box is fixed, so this depends on nothing but the device pixel ratio, and
    // watching that per card would be a state and an effect in every one of
    // them.
    const tier = tierForCellWidth(STRIP_CARD_CSS_BINDING_EDGE, useDevicePixelRatio())
    // ONE FLOOR FOR THE WHOLE STRIP, read here and passed down exactly as the
    // result grid reads it (lib/useClientConfig.ts): the strip needs it for
    // two questions per card that are the same question — which cards can
    // hover-play a stored loop (D10), and which of them are already animating
    // in their own `<img>` and must not carry a badge saying they are not
    // (D8). react-query keeps the object's identity across refetches that
    // change nothing.
    const animatedFloor = useAnimatedFloor()
    // The pointer tracking the hover arming reads — bound for as long as the
    // strip is mounted, refcounted with the grid's (see trackHoverPointer).
    useEffect(() => trackHoverPointer(), [])
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
            // The peek's clear while the viewer is open (§8.1). Per-CARD
            // leaves cannot own it: card→card would clear in the gap before
            // the next card's 200ms dwell lands, and the surface falls back
            // to the fixed item for that gap — the picture strobes as you
            // sweep the strip. The strip's own leave is the event that
            // actually means "stop peeking", and it fires wherever the
            // pointer goes: the board, the viewer, the pagination row.
            // Unconditional, like the card handlers: a clear that exists only
            // in some states is the stranded-subject trap (see bodyPeeks).
            onMouseLeave={onItemHover ? () => onItemHover(null, -1) : undefined}
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
                                viewerOpen={viewerOpen}
                                onViewerOpenChange={onViewerOpenChange}
                                tier={tier}
                                animatedFloor={animatedFloor}
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
    viewerOpen,
    onViewerOpenChange,
    tier,
    animatedFloor,
}: {
    item: SearchResult
    ownIndex: number
    nItems: number
    style: React.CSSProperties
    /** The gallery's position write — see the strip's own prop. */
    onNavigate: (index: number) => void
    /**
     * Hover reporting for the overlay preview, and the gate on the preview
     * button existing at all — see the strip's own prop.
     */
    onItemHover?: (item: SearchResult | null, index: number) => void
    /** The pinned viewer's open state and setter — see the strip's props. */
    viewerOpen?: boolean
    onViewerOpenChange?: (open: boolean) => void
    /** The rendition tier for the card box — computed once by the strip. */
    tier: ThumbnailTier
    /** The animated raw floor — read once by the strip. See its own read. */
    animatedFloor: AnimatedFloor | null
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
    // The card paints `object-cover object-top` in a 240x320 box, which is
    // exactly the presentation the grid tiers' crop is cut for — so an
    // extreme-aspect item needs no special case here: the crop IS what this
    // card should show, and there is no hover-contain state to swap for.
    //
    // ALWAYS THE STILL for an animated item. Adjudicated for F6 and unchanged
    // by D10: the strip's BASE picture is a poster, and nothing here ever
    // autoplays — a row of looping cards under the gallery is noise, and the
    // strip's job is letting the eye find the next item. What D10 adds is a
    // loop the pointer has to ask for by resting on a card (StripLoopPicture),
    // which is a layer over this URL rather than a change to it. It is also
    // correctness before policy: without the flag an animated item above the
    // raw floor answers a grid tier with `video/mp4`, which this <img> would
    // render as a broken picture.
    //
    // ONE COMPARISON ON ROW DATA, and deliberately the cheap half of the
    // decision — the base picture never plays, so it needs no client-config
    // floor, only "does this item move" (lib/thumbnailTier.ts). `still=true` is
    // documented as a NO-OP for an animated item at or below the floor: it is
    // served as its original file either way, and animates in the <img> exactly
    // as it does today.
    //
    // The display-loop trigger is `null` because this is a GRID tier, where the
    // picture rule never consults it (lib/thumbnailURL.ts) — the strip has no
    // display request to make.
    const thumbnailURL = thumbnailPictureURL(dbs, item, null, tier)
    // The other half, which the HOVER play does need (D10): a stored loop
    // exists only above the raw floor, and only such a card mounts the arming
    // and the <video>. Still one comparison on row data — a static card, or an
    // animated one already animating in its own <img>, keeps today's picture
    // with no listener and no state.
    const animated = animatedCellMode(item, animatedFloor)
    // Every hover report this card makes goes through here, so the card can
    // know whether the dock's hover subject is currently ITS item. Tracked
    // from the reports rather than from raw pointer presence: the unmount
    // clear below must never wipe a peek some other card owns, and only the
    // reports say which card that is.
    const ownsHoverRef = useRef(false)
    const reportHover = onItemHover
        ? (next: SearchResult | null) => {
            ownsHoverRef.current = next !== null
            onItemHover(next, ownIndex)
        }
        : undefined
    // TRAP: a card that UNMOUNTS under a stationary pointer strands its peek.
    // Cards are keyed by file_id, so one leaving the virtual window genuinely
    // unmounts — and React fires no mouseleave for an element that ceased to
    // exist. The path is real and needs no user input: with the viewer open
    // the card BODY is a peek trigger, so a video ending runs
    // advanceToNextVideo → onNavigate → the keep-in-view scrollToIndex above,
    // which can scroll the peeked card out of the window. No leave, `gsv`
    // never moved, dock pinned — so a peek of a card nobody is pointing at
    // covers the viewer until the pointer happens to find another card. The
    // card's own unmount is the only signal that survives virtualization.
    //
    // Latched through a ref rather than depended on: the cleanup must run at
    // UNMOUNT and nowhere else, and `ownIndex` moves under a mounted card as
    // chunks land — a dep array carrying it would fire this clear on a
    // relabel, with the pointer still resting on the card.
    const strandedClearRef = useRef<(() => void) | undefined>(undefined)
    useEffect(() => {
        strandedClearRef.current = reportHover ? () => reportHover(null) : undefined
    })
    useEffect(() => () => {
        if (ownsHoverRef.current) strandedClearRef.current?.()
    }, [])
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
        event.dataTransfer.setData('text/uri-list', originalFileURL(dbs, item.sha256));
        // The hovered card is by definition the drag source, so clear the
        // overlay's hover preview: it portals at z-70 and would sit over the
        // board exactly where the drag is headed (design §8). mouseleave is
        // not reliable mid-HTML5-drag, hence the explicit clear here.
        reportHover?.(null);
    }
    // Does the card BODY peek, as well as its button (§8.1)? A GATE, tested
    // INSIDE the enter handler — never a switch on whether the handlers exist.
    //
    // TRAP: React resolves an element's enter/leave handlers at DISPATCH time
    // from the props last committed, so a handler wired only while some state
    // holds ceases to exist the moment that state flips. Under a stationary
    // pointer the matching LEAVE is then never delivered at all, and whatever
    // the enter opened is stranded. This is not theoretical: with these two
    // conditional, closing the viewer (Esc, Back, or the button's own Shrink)
    // while the pointer rested on a card removed the card's leave in the same
    // commit that collapsed the dock's peek suppression — so a full-size peek
    // of that card appeared over the board and nothing short of hovering
    // another card's BUTTON or hiding the dock could clear it. Mounting them
    // unconditionally is what makes "the pointer left" an event the strip
    // always reports, whichever state it was in when the pointer arrived.
    const bodyPeeks = !!viewerOpen
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
                // The hover-play arming binds to THIS box (D10): it is the one
                // that carries `group`, so the region that plays a loop is the
                // same region the card's own hover chrome fades in over — see
                // hooks/useArmedHover.ts. Static markup, so a card with nothing
                // to play carries four bytes and no behaviour.
                {...{ [CELL_HOVER_ROOT_ATTR]: "" }}
                // Both paths go through the dock's 200ms delayed-open,
                // instant-close hook, and that is what makes body hover safe
                // at all: a sweep across the strip to reach the scrollbar, a
                // pin button or a drag source passes over many cards and must
                // swap nothing. Only a deliberate pause does (§8.1).
                //
                // Present or absent with the PROP, which is fixed per mount
                // (the page gallery never passes it and is untouched), never
                // with the viewer's open state — see the trap on bodyPeeks.
                // Leave clears only while the BUTTON owns the trigger, i.e.
                // with the viewer closed. With it open the peek is STICKY
                // across the strip and the clear belongs to the strip's own
                // leave (see onMouseLeave on the scroller): clearing per card
                // made the fixed item FLASH in the gap between two cards —
                // leaving A clears instantly, arriving at B waits out the
                // 200ms dwell, and the surface falls back to `fixed` for the
                // ~200ms in between, so sweeping across the strip strobed the
                // picture. The handlers themselves are present or absent with
                // the PROP, which is fixed per mount (the page gallery never
                // passes it and is untouched), NEVER with the viewer's open
                // state — see the trap on bodyPeeks.
                onMouseEnter={reportHover
                    ? () => { if (bodyPeeks) reportHover(item) }
                    : undefined}
                onMouseLeave={reportHover
                    ? () => {
                        // The card's CLAIM on the subject ends whenever the
                        // pointer leaves it, even in the sticky case where
                        // the peek itself stays — `ownsHoverRef` answers
                        // "does the dock's subject belong to me", and only
                        // `reportHover` writes it. Left set, every card the
                        // pointer had ever visited would still believe it
                        // owned the peek, and the unmount clear below would
                        // fire for a card that owns nothing: a keep-in-view
                        // scroll or a wheel pan recycles it and wipes the
                        // peek some OTHER card is holding.
                        ownsHoverRef.current = false
                        if (!bodyPeeks) reportHover(null)
                    }
                    : undefined}
            >
                <Link href={imageLink} onClick={onClick}>
                    <div className="w-full h-full relative">
                        {animated === "loop"
                            ? <StripLoopPicture
                                poster={thumbnailURL}
                                loop={thumbnailMediaURL(dbs, item.sha256, tier)}
                                alt={item.path}
                                blurDataURL={blurDataURL}
                            />
                            : <StripCardImage
                                src={thumbnailURL}
                                alt={item.path}
                                blurDataURL={blurDataURL}
                            />}
                    </div>
                </Link>
                {/* Same stacking rule as the grid card's copy: after the
                    link, before the spinner and the hover verbs.

                    "hover", always: the strip's animate mode is not the
                    grid's preference but a fixed policy (D10) — its cards
                    show posters and play only what the pointer dwells on —
                    so a card that CAN move and is not moving is exactly what
                    the badge is for. */}
                {showsMotionBadge(item, animatedFloor, "hover") && <PlayableBadge />}
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
                {/* The preview trigger (design §8.1), top-center because
                    the four corners are taken. Rendered only where the
                    preview surface exists — the overlay mount, which is the
                    one that passes onItemHover; the page gallery has a large
                    image already and a second preview over it would be
                    noise. Its click runs the CARD's selection write verbatim
                    (§8.1's identity rule: there is no second selection
                    concept), because it paints over the card's Link and a
                    control that swallows the click without doing what the
                    card would is a 40px dead zone on every card.

                    The other half of the click is the viewer toggle (§8.1),
                    and the three cases fall out of one comparison because
                    selection and "the item in the viewer" are the same thing:
                    closed → open it here; open ON THIS CARD → close it; open
                    on ANOTHER card → the selection write above already moved
                    the viewer, so the flag must not be touched. Guarding on a
                    real change matters, not just tidiness: `gsv` is a
                    history:push param, and re-writing `true` while swapping
                    would bury the back button under one entry per swap.

                    No `onViewerOpenChange` means there is no viewer surface to
                    toggle at all (the dock withholds the setter where a second
                    GalleryImageLarge would collide with the gallery's own) —
                    the button then keeps only its P5 half, select + peek, and
                    its label says so. */}
                {reportHover && (
                    <PreviewButton
                        canToggleViewer={!!onViewerOpenChange}
                        isViewerItem={!!viewerOpen && isSelected}
                        onEnter={() => reportHover(item)}
                        // RE-ASSERTS rather than clears while the body owns
                        // the trigger, because mouseenter/mouseleave ignore
                        // moves between a container and its descendants: the
                        // figure delivers no re-entry when the pointer slides
                        // off the button back onto the card, so a plain null
                        // here would drop a peek under a pointer that never
                        // left. Leaving the CARD still clears it — leave
                        // events fire innermost-first, so the figure's null
                        // lands after this one.
                        onLeave={() => reportHover(bodyPeeks ? item : null)}
                        onSelect={() => {
                            const nextOpen = !(viewerOpen && isSelected)
                            onNavigate(ownIndex % nItems)
                            setSelected(item)
                            if (nextOpen !== !!viewerOpen) {
                                onViewerOpenChange?.(nextOpen)
                            }
                        }}
                    />
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

/**
 * The strip card's picture, for every card that is not a hover-playable loop —
 * which is all of them until an animated item above the raw floor comes past.
 *
 * Its own component only so that the loop card below can reuse it verbatim as
 * the poster it plays over: the two must be the SAME element with the same
 * classes, or the moment the video fades in would also be a moment the picture
 * moved.
 */
function StripCardImage({ src, alt, blurDataURL, elementRef }: {
    src: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    elementRef?: (element: HTMLImageElement | null) => void
}) {
    return (
        <Image
            ref={elementRef}
            src={src}
            alt={alt}
            className="object-cover object-top rounded-md cursor-pointer"
            fill
            // Direct data URL, never `placeholder="blur"` — the filmstrip
            // virtualizes and remounts a card per item exactly like the grid,
            // and 'blur' would emit a unique `data:image/svg+xml` blur wrapper
            // per mount, each of which Blink instantiates as its own isolated
            // Document. Those pile up faster than GC collects them and degrade
            // frame time for the whole session (see the comment in
            // components/SearchResultImage.tsx). Do not reintroduce. The
            // data-URL template type is the real guard (next/image validates
            // only in dev); `?? 'empty'` just documents the fallback.
            placeholder={blurDataURL ?? 'empty'}
            unoptimized={true}
            sizes="240px"
        />
    )
}

/**
 * The strip card of an item that MOVES and has a stored loop (D10): the poster
 * it has always shown, which plays once the pointer dwells on the card.
 *
 * HOVER, NEVER UNPROMPTED, and that is a policy of the strip rather than the
 * user's preference: a row of cards all looping under the gallery is noise,
 * and the strip's job is letting the eye find the next item. It is also why
 * the strip has never asked for anything but posters.
 *
 * MOUNTED ONLY FOR LOOP CARDS, exactly as in the grid and for the same reason:
 * the arming state, the two listeners and the media element are in here, so
 * every other card in the strip renders the `<Image>` it always did and mounts
 * none of it.
 */
function StripLoopPicture({ poster, loop, alt, blurDataURL }: {
    poster: string
    loop: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
}) {
    const [failed, setFailed] = useState(false)
    const hover = useArmedHover(!failed)
    return (
        <>
            <StripCardImage
                elementRef={hover.attach}
                src={poster}
                alt={alt}
                blurDataURL={blurDataURL}
            />
            {hover.active && (
                <LoopVideo
                    src={loop}
                    poster={poster}
                    alt={alt}
                    // The poster underneath is the placeholder; a blurhash
                    // behind a layer fading in over a painted picture would be
                    // the flash the fade exists to avoid.
                    blurDataURL={undefined}
                    className="object-cover object-top rounded-md"
                    fadeIn
                    registered
                    onFailed={() => setFailed(true)}
                />
            )}
        </>
    )
}

// The strip card's preview trigger (design §8.1): hover shows the item on
// the maximized board's preview surface, and with the viewer CLOSED it is
// the only thing on the card that does — an unconditional full-screen
// takeover on every pointer sweep covers the board precisely when the user
// is reaching across it to drop something. Once the viewer is open the
// takeover has already happened and the card body takes the hover over (see
// bodyPeeks); the button stays for its other half, which is the one control
// on this card whose meaning is explicit.
//
// Top-center: the four corners are taken by BookmarkBtn, PinButton,
// FindButton and the FileActionCluster. Every other class is theirs
// verbatim (the white pill, the group-hover reveal, the 300ms opacity
// fade), so the five verbs read as one set; only the centering translate is
// new, and in Tailwind 4 `translate` and `scale` are separate CSS
// properties, so it composes with hover:scale-105 rather than fighting it.
//
// draggable + a cancelling dragstart, NOT draggable={false}: the card is the
// HTML5 drag source and the drag source is the nearest DRAGGABLE ancestor of
// the press — a `false` child is skipped over, not honoured, so the figure
// would still start an item drag. Making the button its own source and
// preventing the default cancels the drag outright. This is a deliberate
// deviation from the corner buttons, which leave the pass-through drag
// alone: this one is a HOVER target first, so the pointer resting on it is
// the normal state, and a drag born under a pointer that is holding a
// preview open is the one gesture it must never produce.
//
// stopPropagation is load-bearing next to that preventDefault: dragstart
// BUBBLES, so cancelling the drag here does not stop the figure's own
// handler from running, and that handler clears the hover preview (it
// assumes the hovered card is the drag source). Without it, a press on the
// button kills the preview the user is looking at and nothing brings it back
// until the pointer leaves and re-enters.
//
// No `title`: its native tooltip surfaces about a second after the pointer
// settles — i.e. floating over the preview this button just opened. The
// aria-label carries the same text for anything that needs it.
function PreviewButton({
    canToggleViewer,
    isViewerItem,
    onEnter,
    onLeave,
    onSelect,
}: {
    /**
     * Can a click reach the viewer at all? False in the one state where the
     * dock stands the viewer down, and the label must not go on promising a
     * surface that will not appear.
     */
    canToggleViewer: boolean
    /**
     * Is the pinned viewer open on THIS card's item? The glyph says which of
     * §8.1's three outcomes a click will produce, and only "close" needs its
     * own one — swapping the viewer to another card is the same expand
     * gesture as opening it.
     */
    isViewerItem: boolean
    /**
     * The peek trigger. ALWAYS wired, even where the card body peeks too
     * (§8.1, viewer open) — what changes there is what `onLeave` reports,
     * because sliding off the button back onto the card delivers no re-entry
     * from the figure (enter/leave ignore container↔descendant moves), so a
     * leave that cleared would drop a peek under a pointer that never left.
     * Making the handler conditional instead is the trap documented on
     * bodyPeeks: a listener that disappears under a resting pointer never
     * delivers its leave at all.
     */
    onEnter: () => void
    onLeave: () => void
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            aria-label={!canToggleViewer
                ? "Preview this item"
                : isViewerItem ? "Close the viewer" : "Open this item in the viewer"}
            draggable
            onDragStart={(e) => {
                e.preventDefault()
                e.stopPropagation()
            }}
            onClick={onSelect}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            className="hover:scale-105 absolute top-2 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        >
            {isViewerItem
                ? <Shrink className="w-6 h-6 text-gray-800" />
                : <Expand className="w-6 h-6 text-gray-800" />}
        </button>
    )
}
