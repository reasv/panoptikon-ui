"use client"
import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { FilePathComponent } from "@/components/imageButtons"
import { OpenDetailsButton } from "@/components/OpenFileDetails"
import { Button } from "@/components/ui/button"
import { GalleryImageLarge, isPlayableVideo } from "@/components/gallery/ImageGallery"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSidebarOverlayOpen } from "@/lib/state/gallery"
import { usePinboardCarry } from "@/lib/state/pinboardCarry"
import { scanLoadedForward } from "@/lib/scrollMode"
import { cn, getLocale, hasOpenLayer } from "@/lib/utils"
import type { ResultsSource } from "@/lib/searchHooks"
import { boundsHeightTerm, fittedBoxStyle, VIEWER_BOUNDS } from "./previewBox"

// The maximized board's PINNED ITEM VIEWER
// (docs/maximized-pinboard-search-overlay-design.md §8.3). The maximized
// workspace has no large-image surface and the board was the only way to play
// a video in this UI; this is what closes that gap, and it does so by reusing
// GalleryImageLarge whole rather than reimplementing it — the playability
// ladder, transcode rendition, trim/outro handling, end-action loop/stop,
// fullscreen host, click-half navigation and drag-out all come along, and a
// divergence from the page gallery would mean the extraction leaked.
//
// The header is RECOMPOSED, not extracted: the gallery header's prev/next
// arrows, thumbnails toggle and close-GALLERY semantics are gallery-specific,
// while the atoms under them are not. No strip (the dock's strip IS it), no
// pagination row, no prev/next chrome — the viewer is the gallery's picture,
// not the gallery's frame.

// The header row's height, as a Tailwind class and as the CSS length the
// picture's fit has to give back. Two forms of one number: the header stacks
// above the picture inside the same bounds the hover peek uses whole, so a
// picture fitted against the full bounds height would push the frame past
// them. 3rem matches the 48px header band the gallery and grid panels share.
const HEADER_CLASS = "h-12"
const HEADER_RESERVE = "3rem"
const PICTURE_HEIGHT_TERM = boundsHeightTerm(HEADER_RESERVE)

// The viewer has no page turns and no fetch to invalidate, so there is never
// a pending advance to cancel — GalleryImageLarge's own supersession contract
// (docs/video-end-action-design.md §3) is satisfied by there being nothing to
// supersede. Module-level so it is one identity for every render.
const NO_PENDING_ADVANCE = () => { }

/**
 * The navigable extent and the position INSIDE it — one expression, because
 * every other surface on this screen clamps and a viewer that did not was P6's
 * worst bug: `source.get(outOfRange)` is undefined, and useViewerItem's held-
 * item fallback (written for a chunk still in flight, which lands) then holds
 * FOREVER. The viewer painted a file that was not in the results, its header
 * verbs acted on it, and the strip rang the clamped card whose preview button
 * claimed it would "close the viewer". Nothing keeps `gi` inside the set for
 * us: useResetPage zeroes it only on a query-option change made while the
 * page is ALREADY 1 (from any later page it resets the page and leaves the
 * index alone), so a refresh after a scan removed files, a DB switch, or a
 * search returning fewer rows walks straight into it.
 *
 * `extent` is the gallery's own correction, verbatim (see its `count`): while
 * the count query is in flight the source's answer is the still-growing
 * LOADED extent, which on a cold deep link is the SSR-hydrated first page.
 * TRAP — clamping against the RAW count there would resolve `gi=5000` onto
 * row 9 and publish an item from the wrong end of the set until the real
 * count lands. Until it settles the position the URL names IS part of the
 * extent, so it survives the clamp and the viewer shows its loading frame;
 * afterwards it is not, and a stale link past the end clamps onto the last
 * row rather than waiting forever for a row that no longer exists.
 *
 * A null index stays null (nothing is addressed), and so does an index into
 * an EMPTY extent: with no rows there is no position to clamp onto, and
 * inventing 0 would only hand the fallback below its excuse to paint a held
 * item that is no longer in the results.
 */
export function viewerPosition(
    count: number,
    countSettled: boolean,
    index: number | null
): { extent: number; index: number | null } {
    const extent = countSettled ? count : Math.max(count, (index || 0) + 1)
    if (index === null || extent <= 0) return { extent, index: null }
    return { extent, index: Math.max(0, Math.min(index, extent - 1)) }
}

/**
 * The viewer's item (§8.3): the LIVE row at the position preferred — the held
 * selection is a snapshot that goes stale the moment a bookmark mutation
 * patches the cached search response, while the row always reflects it — the
 * held item as the fallback for a chunk that has not landed in scroll mode,
 * and undefined when there is neither, for which the caller renders a loading
 * frame (a cold deep link, where the honest answer is "no item yet").
 *
 * The gallery resolves `currentItem` by the same three inputs but keeps the
 * held item when the two DISAGREE, because there it is the last picture that
 * gallery displayed and holding it covers a page transition without a flash
 * of the wrong one. That inversion is only safe because the gallery also owns
 * an effect publishing the row at its index back into the selection, so a
 * disagreement is always transient. Here the row wins outright and the
 * publish rides along below — with the gallery's precedence and no publish,
 * an arrow key would move `gi` and the viewer would go on showing the item it
 * already held, forever.
 *
 * The ONE state where the row loses is `stale`: a page-size change rewrites
 * `gi` and `page_size` in the same tick, so for one render the new index
 * addresses the OLD page's rows and `source.get` answers with an item from
 * neither. The gallery holds through exactly that window for exactly that
 * reason; holding here is safe where the gallery's blanket precedence would
 * not be, because staleness clears on its own within a render or two.
 *
 * `index` must be viewerPosition's — CLAMPED — for any of that to hold: the
 * held-item fallback only makes sense for an index the set actually contains.
 * A null index therefore resolves to nothing at all rather than to the held
 * item: null means "no position", and the fallback answers "this position's
 * chunk has not landed", which is a different sentence.
 *
 * Exported because the dock calls it too: it needs the viewer's item to
 * suppress a hover peek OF the item already in the viewer.
 */
export function useViewerItem(
    source: ResultsSource,
    index: number | null,
    stale: boolean
): SearchResult | undefined {
    const selectedItem = useItemSelection((state) => state.getSelected())
    if (index === null) return undefined
    const row = source.get(index)
    if (stale) return selectedItem ?? row ?? undefined
    return row ?? selectedItem ?? undefined
}

// Duck the viewer for the duration of an HTML5 drag (§8.4). It is
// pointer-events-auto and sits over the board's CENTRE — exactly where drops
// land — so unlike the dock, which only covers an edge, even the PINNED
// surface has to get out of the way. Transparent and inert, never unmounted:
// playback continues underneath (sub-second, accepted) and a <video> torn
// down and rebuilt per drag would restart from zero.
//
// A drag whose SOURCE is inside the viewer is exempt, and the rationale above
// is exactly why: what the ducking buys is an unobstructed board underneath,
// and a drag that started on the viewer's own picture (GalleryImageLarge's
// drag-out, or a text drag on the header's path) is not headed for the board.
// Ducking it blanks the picture the user is dragging out of, and a drag that
// ends over ANOTHER WINDOW delivers no dragend here — so the picture stays
// invisible until the pointer comes back and moves.
//
// The restore is deliberately over-subscribed, because HTML5 drag events are
// not reliable enough to hang a permanent visual state on: `dragend` fires on
// the SOURCE, which the virtualized strip can recycle mid-drag, and a drag
// that ends over another window may deliver neither `dragend` nor `drop`
// here. The net under both is the pointer itself — the browser suppresses
// mouse and pointer events for the whole duration of a drag, so the first one
// delivered after a drag started is proof it is over. Subscribed only while
// ducked, i.e. from a commit that happens strictly after `dragstart`, so the
// moves that BEGAN the drag cannot un-duck it immediately. `pointerup` earns
// its place separately: a `dragstart` the target CANCELS (the strip's preview
// button does exactly that) dispatches here and then never produces a
// `dragend`, and the release is the first event that follows it.
function useDragDucked(rootRef: React.RefObject<HTMLDivElement | null>) {
    const [ducked, setDucked] = useState(false)
    useEffect(() => {
        const onDragStart = (e: DragEvent) => {
            const target = e.target
            if (target instanceof Node && rootRef.current?.contains(target)) return
            setDucked(true)
        }
        document.addEventListener("dragstart", onDragStart, true)
        return () => document.removeEventListener("dragstart", onDragStart, true)
    }, [rootRef])
    useEffect(() => {
        if (!ducked) return
        const restore = () => setDucked(false)
        document.addEventListener("dragend", restore, true)
        document.addEventListener("drop", restore, true)
        window.addEventListener("mousemove", restore)
        window.addEventListener("pointerdown", restore)
        window.addEventListener("pointerup", restore)
        return () => {
            document.removeEventListener("dragend", restore, true)
            document.removeEventListener("drop", restore, true)
            window.removeEventListener("mousemove", restore)
            window.removeEventListener("pointerdown", restore)
            window.removeEventListener("pointerup", restore)
        }
    }, [ducked])
    return ducked
}

// Esc closes the viewer, and must not ALSO reach the board's clear-selection
// handler (§8.4). The board registers that one on `window` in the BUBBLE
// phase — the very last stop on a keydown's propagation path — so a
// `window` CAPTURE listener here is the first, and its stopPropagation makes
// the ordering a property of the DOM rather than of which effect happened to
// subscribe first.
//
// Being first also means standing down wherever Esc already belongs to
// someone else, since nothing downstream gets a second chance:
//
//   - a text field: Esc there is that field's own key. The tag autocomplete
//     blurs its input on it (tagInput.tsx), and the stopPropagation below
//     would eat that — so typing in the dock's search bar and pressing Esc
//     would close the VIEWER and leave the dropdown up;
//   - element fullscreen: Esc is the browser's own exit (the board's handler
//     checks the same thing);
//   - any genuinely open popup layer — dialogs (the details dialog this
//     header opens), Radix menus, selects — which own the keyboard over
//     whatever is beneath them, and whose own Esc must close THEM, not the
//     surface they sit on. TRAP: the marker list is shared (hasOpenLayer) and
//     deliberately excludes `[role="listbox"]`, which cmdk renders on an
//     always-mounted element — with it, this guard matched on every tag-
//     indexed database and Esc never closed the viewer at all, while the X
//     button's tooltip went on advertising the key;
//   - anything carrying data-esc-owner, and
//   - a live sticky carry, which cancels on Esc.
//
// data-esc-owner is the marker for "an Esc handler on this element claims the
// key while it is in the DOM", and it exists because that question does not
// line up with any single existing attribute. It is worn today by the board's
// THREE modal gestures — hole targeting and Scale & Move, which have overlay
// elements (data-hole-overlay / data-transform-overlay, both of which are
// identity attributes used for pointer hit-test exemptions and merely
// coincide with Esc ownership), and CROP MODE, which has no overlay at all:
// it restyles a pin, registers a window BUBBLE Esc, and would therefore have
// been invisible to any list of overlay names. That is why a dedicated
// attribute rather than a third name in this selector: the guard asks one
// question, so it tests one predicate, and a new modal gesture declares
// itself at its own site instead of waiting for someone to remember a
// selector in this file.
//
// The player surface wears it too. Its hand-rolled popovers ALL dismiss on
// Esc (useDismissOnOutside registers a `document` capture listener, which is
// downstream of this `window` capture one and never runs once this
// stopPropagation fires). The kebab, download and native-escape menus carry
// role="menu" and are already covered by the shared list; the TRIM popover
// carries no role — it is a row of trim controls, not a menu — so it marks
// itself while PINNED, which is exactly when it acts on the key. (There is
// no volume popover at all: volume is an inline <input type=range>.)
function useViewerEscape(onClose: () => void) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return
            const t = e.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            if (document.fullscreenElement !== null) return
            if (hasOpenLayer("[data-esc-owner]")) return
            if (usePinboardCarry.getState().sha256 !== null) return
            e.preventDefault()
            e.stopPropagation()
            onClose()
        }
        window.addEventListener("keydown", onKey, true)
        return () => window.removeEventListener("keydown", onKey, true)
    }, [onClose])
}

export function SearchViewer({
    item,
    source,
    extent,
    resultsAreStale,
    index,
    onNavigate,
    onClose,
}: {
    /** Resolved by useViewerItem in the dock — undefined is the loading state. */
    item: SearchResult | undefined
    /** The same rows the strip and the grid read — for the advance scan. */
    source: ResultsSource
    /**
     * The navigable extent, corrected for an in-flight count — viewerPosition
     * computes it, the dock clamps `index` against it, and the steps below
     * bound themselves by it. One number, one owner: a second copy of that
     * expression here is exactly how the viewer and the dock would come to
     * disagree about which positions exist.
     */
    extent: number
    /** Do the rows answer the URL yet? Gates the selection publish below. */
    resultsAreStale: boolean
    /**
     * `gi`, CLAMPED by viewerPosition. Selection and "the item in the viewer"
     * are the same thing (§8), and the clamp is what keeps that true when the
     * URL names a position the result set no longer has.
     */
    index: number | null
    /**
     * The shared useGalleryNavigate write — the one the strip's card clicks
     * and the gallery's own arrows perform, which is what keeps every surface
     * that moves the position from drifting (§5.3).
     */
    onNavigate: (target: number, options?: { history: "push" | "replace" }) => void
    onClose: () => void
}) {
    const boundsRef = useRef<HTMLDivElement>(null)
    const ducked = useDragDucked(boundsRef)
    useViewerEscape(onClose)

    // Publish what the viewer is showing as THE selection, the gallery's own
    // index→selection half. The strip's card clicks already do it; the
    // viewer's arrow keys, click halves and auto-advance move `gi` alone, and
    // without this the sidebar overlay's Details tab (which reads this store)
    // would keep describing whichever card was last clicked while the viewer
    // browsed away from it. Keyed on the resolved row rather than on `source`
    // — that object is minted per render, and the row's identity is what
    // actually changes when the answer does (the ResultsSource dependency
    // rule). Idempotent by construction: setItem skips same-file_id writes.
    // Gated on `resultsAreStale` for the gallery's documented reason: an item
    // resolved against the wrong page, published as the selection, makes
    // SearchPage's selection→index effect rewrite `gi` to wherever that item
    // happens to land in the new page — a page-size change would move the
    // position instead of relabelling it.
    const setSelectedItem = useItemSelection((state) => state.setItem)
    useEffect(() => {
        if (!resultsAreStale && item) setSelectedItem(item)
    }, [item, resultsAreStale, setSelectedItem])

    // CLAMPED steps — never wrapping. TRAP: this used to be the gallery's
    // modulo, which reads like a wrap but is unreachable at a boundary there,
    // because the gallery's own branches take the last/first index first and
    // turn the page (or do nothing). Taken literally the modulo teleports: `→`
    // on the last item of page 1 lands on its FIRST item and pushes a history
    // entry for the jump.
    //
    // No page turns, deliberately, and this is the divergence from the gallery
    // that §8.3 permits: in scroll mode `extent` is the whole set and there is
    // no page to turn; in pages mode the dock's own PageSelect sits directly
    // below this surface and is the page control, so a viewer that turned
    // pages by itself would move the strip and the pagination out from under
    // the user's hand — and it would have to carry the gallery's fetch-then-
    // flip machinery to do it without showing a wrong item mid-turn. So the
    // end of a page is where the arrows stop: nothing moves, nothing is
    // pushed, and the page control is one glance away.
    const step = (delta: number) => {
        if (extent <= 0) return
        // No position yet (the dock's seed has not committed): the first step
        // lands ON row 0. `(index || 0) + delta` would read null as "before
        // 0" and `→` would skip the first row of the set outright.
        if (index === null) {
            onNavigate(0)
            return
        }
        const target = Math.max(0, Math.min(index + delta, extent - 1))
        if (target !== index) onNavigate(target)
    }
    const prevImage = () => step(-1)
    const nextImage = () => step(1)
    // Auto-advance, the gallery's in-page scan (§8.3): walk the rows the
    // source has LOADED for the next item this browser will play unattended
    // and land on it. Running off the loaded window ends the chain rather
    // than fetching its way across the set — the gallery pays for that
    // continuation with page-turn and prefetch machinery this surface
    // deliberately does not carry, and a run of unplayable rows must not
    // become a crawl through the result set. "replace", like every write on
    // an unattended path (docs/video-end-action-design.md §4).
    //
    // Both of GalleryImageLarge's arguments are ignored, and both for the
    // same reason: `playback` gates page turns and `isFullscreen` forks them,
    // and there are no page turns here.
    const advanceToNextVideo = () => {
        if (extent <= 0) return
        const scan = scanLoadedForward(
            (i) => source.getBlock(i),
            index === null ? 0 : index + 1,
            extent,
            isPlayableVideo,
        )
        if (scan.match !== null) onNavigate(scan.match, { history: "replace" })
    }

    // The picture's box: the item's aspect fitted into the shared bounds,
    // capped at natural size, with the header's band given back. Split across
    // two elements — the frame takes the WIDTH so it hugs the picture, the
    // picture row takes the ASPECT so its height follows from that width and
    // the column comes out exactly as tall as the fit.
    //
    // Driven by the item's CODED dimensions alone, deliberately: the peek
    // upgrades to an element-confirmed, rotation-corrected aspect (§8.2)
    // because it is a plain <img> that costs nothing to re-lay-out, and
    // because a snug frame around a wrong aspect is all it has. Here the
    // ladder is delegated INSIDE the box instead, to GalleryImageLarge's own
    // `mediaAspect` — which already walks it for its overlays — and the
    // picture is object-contain within the box either way. The trade: an
    // EXIF-rotated still gets a landscape frame with the portrait picture
    // letterboxed inside it, which is the pre-P5 behavior and still shows the
    // whole picture the right way up. What it buys: no resize of a box
    // containing a LIVE <video> the moment its metadata lands — that would
    // re-lay-out the element, the player surface and the click zones mid-
    // playback, and reporting the aspect back out would need a second prop on
    // GalleryImageLarge when §8.3 allows exactly one.
    const fitted = fittedBoxStyle(
        item?.width && item?.height ? item.width / item.height : null,
        item?.width,
        item?.height,
        PICTURE_HEIGHT_TERM,
    )

    return (
        // The bounds are pointer-transparent so the board keeps every click
        // in the letterbox beside a portrait item; only the frame takes
        // events. z-50 alongside the dock, NOT above it: at the shared level
        // the hover peek (z-70) still renders over the viewer without
        // unmounting it, the carry ghost (z-60) still rides above, and
        // body-portaled Radix layers still stack over both by DOM order —
        // the same treatment the dock panel and the fullscreen toolbar get
        // (§7). The two never overlap anyway: the bounds subtract the dock's
        // published inset.
        <div
            ref={boundsRef}
            className={cn(
                "pointer-events-none fixed z-50 flex items-center justify-center",
                "transition-opacity duration-100",
                ducked && "opacity-0",
            )}
            style={VIEWER_BOUNDS}
        >
            {/* data-search-overlay: the maximized board's viewport-marquee
                starter and its click-outside deselect both exempt that
                selector (GalleryPinBoard), so pressing the viewer's header
                neither rubber-bands the board underneath nor clears the pin
                selection (§8.4). Reused rather than a new attribute — it
                keeps both hand-maintained lists short. */}
            <div
                data-search-overlay
                className={cn(
                    "flex max-h-full flex-col overflow-hidden rounded-md border bg-background shadow-xl",
                    ducked ? "pointer-events-none" : "pointer-events-auto",
                    // No fit: the item carries no dimensions (rows from older
                    // scans), so the box spans the bounds and object-contain
                    // letterboxes — §8.2's unprobed fallback.
                    !fitted && "h-full w-full",
                )}
                style={fitted ? { width: fitted.width } : undefined}
            >
                <ViewerHeader item={item} onClose={onClose} />
                <div
                    className={cn("relative", fitted ? "w-full" : "min-h-0 flex-1")}
                    style={fitted ? { aspectRatio: fitted.aspectRatio } : undefined}
                >
                    {item ? (
                        <GalleryImageLarge
                            item={item}
                            prevImage={prevImage}
                            nextImage={nextImage}
                            advanceToNextVideo={advanceToNextVideo}
                            cancelPendingAdvance={NO_PENDING_ADVANCE}
                            // Inert under the height override — they exist
                            // only to build the expression it replaces.
                            thumbnailsOpen={false}
                            showPagination={false}
                            heightClass="absolute inset-0"
                        />
                    ) : (
                        // The gallery's loading frame, verbatim: nothing here
                        // may depend on a row, and nothing may throw waiting
                        // for one.
                        <div className="absolute inset-2 animate-pulse rounded bg-muted" />
                    )}
                </div>
            </div>
        </div>
    )
}

// Label and viewer chrome, and nothing else: the file verbs (bookmark, open
// file, open folder, share) live on the strip card's own hover overlay, which
// acts on this very item — selection and the viewer's subject are the same
// thing (§8) — so carrying them here as well would be duplicating the card
// into a surface whose whole job is showing the picture. Accepted cost, and
// the reason this is a deliberate choice rather than an oversight: with the
// dock unpinned and hidden the card is off-screen, so acting on the item
// means bringing the dock back first.
//
// The path sits in the middle track of a symmetric 1fr grid rather than a
// flex `flex-1`, so it is centered on the FRAME, not on whatever space the
// button clusters leave over — the gallery header's flex arrangement is
// balanced only because its two sides carry the same number of controls, and
// this one's never will.
function ViewerHeader({
    item,
    onClose,
}: {
    item: SearchResult | undefined
    onClose: () => void
}) {
    // The details button points at the SIDEBAR OVERLAY, not the page sidebar:
    // that one is unmounted for the whole maximized session, so the default
    // `sb` write would open nothing here and would strand a flag that pops the
    // page sidebar open on restore. `gsb` is the overlay's PIN, which is the
    // right lever — pressing a "show me the data" button is exactly the intent
    // to keep the panel around, and unpinning while the pointer is still over
    // the panel hides it on the next leave, per that dock's show formula.
    const [sidebarPinned, setSidebarPinned] = useSidebarOverlayOpen()
    return (
        <div className={cn(
            "grid shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center",
            "border-b px-2",
            HEADER_CLASS,
        )}>
            {/* One control per side, so the two sides weigh the same and
                the label between them is centered by construction. Close
                takes the right, where every close in this UI (and every
                window) lives; the remaining control takes the left rather
                than doubling up beside it. */}
            <div className="col-start-1 flex items-center justify-start">
                <OpenDetailsButton
                    item={item}
                    target={{
                        open: sidebarPinned,
                        setOpen: (open) => void setSidebarPinned(open),
                    }}
                />
            </div>
            <div className="col-start-2 min-w-0 px-2 text-center">
                {item && <>
                    <FilePathComponent path={item.path} />
                    <p className="text-xs text-gray-500 truncate">
                        {getLocale(new Date(item.last_modified))}
                    </p>
                </>}
            </div>
            <div className="col-start-3 flex items-center justify-end">
                <Button
                    onClick={onClose}
                    variant="ghost"
                    size="icon"
                    title="Close viewer (Esc)"
                    aria-label="Close viewer"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
