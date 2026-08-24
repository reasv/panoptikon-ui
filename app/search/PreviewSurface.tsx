"use client"
import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { FilePathComponent } from "@/components/imageButtons"
import { OpenDetailsButton } from "@/components/OpenFileDetails"
import { Button } from "@/components/ui/button"
import { GalleryImageLarge, isPlayableVideo } from "@/components/gallery/ImageGallery"
import { useItemSelection } from "@/lib/state/itemSelection"
import { usePinboardCarry } from "@/lib/state/pinboardCarry"
import { scanLoadedForward } from "@/lib/scrollMode"
import { cn, getLocale, hasOpenLayer } from "@/lib/utils"
import type { ResultsSource } from "@/lib/searchHooks"
import { PeekLayer } from "./PeekLayer"
import { fittedBoxStyle, PREVIEW_BOUNDS, UNFITTED_BOX_STYLE } from "./previewBox"

// The maximized board's PREVIEW SURFACE
// (docs/maximized-pinboard-search-overlay-design.md §8). ONE box, two
// subjects:
//
//     displayed = peeked ?? fixed
//
// where `fixed` is the viewer's item (`gi`, present only while the viewer is
// open) and `peeked` is the ephemeral hover subject. This used to be two
// framed surfaces — a cheap <img> peek and a viewer that layered over it —
// and the user rejected that for exposing an implementation detail as UI:
// clicking a peek visibly shrank the picture and stacked a second frame over
// the first. The split existed only because mounting a real player per
// hover-sweep would churn video decoders, which is a reason the user should
// never have to perceive.
//
// What the merge has to preserve, and how it does:
//
//   - NOTHING RESIZES WHEN YOU FIX A PEEK. Same box, same position, same fit
//     — the chrome that appears is OVERLAID on the picture (ViewerHeader
//     below), never a layout row, and the aspect the box was fitted with
//     survives the transition (see `confirmed`).
//   - THE BOX FITS WHATEVER IS DISPLAYED, so peeking a portrait item while a
//     landscape one is fixed re-fits to the portrait. §8.4 makes that a
//     deliberate exception to the no-resize rule: the resize IS the user's
//     own gesture, and letterboxing the peek inside the fixed item's frame
//     would reintroduce the complaint that started all of this.
//   - THE FIXED ITEM'S PLAYER STAYS MOUNTED UNDER A PEEK. The peek is a
//     LAYER inside the box (PeekLayer), rendered AFTER GalleryImageLarge and
//     never in place of it, so a playing video keeps playing underneath and
//     is revealed still playing when the pointer leaves. This is the one
//     property the two-surface split bought and the whole reason the peek is
//     a layer rather than a swap of the box's content.
//
// The viewer half reuses GalleryImageLarge whole rather than reimplementing
// it — the playability ladder, transcode rendition, trim/outro handling,
// end-action loop/stop, fullscreen host, click-half navigation and drag-out
// all come along, and a divergence from the page gallery would mean the
// extraction leaked. Its header is RECOMPOSED, not extracted: the gallery
// header's prev/next arrows, thumbnails toggle and close-GALLERY semantics
// are gallery-specific, while the atoms under them are not. No strip (the
// dock's strip IS it), no pagination row — the viewer is the gallery's
// picture, not the gallery's frame.

// How far an element-confirmed aspect must differ from the item-dimensions
// one before the box is resized to it. Purely a no-op filter: an agreeing
// element would otherwise re-lay the box out over a rounding difference. An
// EXIF rotation — the case this exists for — swaps the ratio outright and
// clears this by a mile.
const ASPECT_TOLERANCE = 0.02

// How many element-confirmed aspects are remembered (see `confirmed`). Enough
// that walking a few items back and forth keeps their corrections, small
// enough to stay a cache rather than a leak on a scroll-mode set of a hundred
// thousand rows.
const CONFIRMED_MAX = 8

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

// Duck the surface for the duration of an HTML5 drag (§8.4). It is
// pointer-events-auto while the viewer is open and sits over the board's
// CENTRE — exactly where drops land — so unlike the dock, which only covers
// an edge, even the PINNED surface has to get out of the way. Transparent and
// inert, never unmounted: playback continues underneath (sub-second,
// accepted) and a <video> torn down and rebuilt per drag would restart from
// zero.
//
// A drag whose SOURCE is inside the surface is exempt, and the rationale above
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
// `open` gates the whole subscription, because this surface now also mounts
// for a peek with no viewer behind it (§8): there is nothing to close then,
// and claiming the key would swallow the board's own Esc for as long as a
// pointer rested on a strip card.
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
function useViewerEscape(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return
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
    }, [open, onClose])
}

/** An aspect the shared thumbnail layer has actually painted, per file. */
type ConfirmedAspect = { sha: string; ratio: number }

export function PreviewSurface({
    viewerOpen,
    item,
    peek,
    source,
    extent,
    resultsAreStale,
    index,
    onNavigate,
    onClose,
}: {
    /**
     * Is the VIEWER half up? The surface itself mounts for either subject —
     * a peek alone is enough — and this is what says whether there is a fixed
     * one underneath it: whether a player is mounted, whether the header
     * exists, whether Esc and the pointer belong to this surface.
     */
    viewerOpen: boolean
    /** Resolved by useViewerItem in the dock — undefined is the loading state. */
    item: SearchResult | undefined
    /**
     * The ephemeral hover subject, or null. It NEVER writes `gi` and never
     * touches the fixed item: it is painted as a layer over it (§8.4), so
     * glancing at a neighbour cannot disturb what the viewer is playing.
     */
    peek: SearchResult | null
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
    useViewerEscape(viewerOpen, onClose)
    // The fixed subject: the viewer's item, and only while the viewer is
    // actually up. A peek that opened this surface on its own has no fixed
    // item behind it, and `item` is resolved from `gi` regardless of the
    // flag, so this is what keeps a closed viewer from quietly publishing a
    // selection or mounting a player behind a glance.
    const fixed = viewerOpen ? item : undefined
    const displayed = peek ?? fixed

    // Publish what the VIEWER is showing as THE selection, the gallery's own
    // index→selection half. The strip's card clicks already do it; the
    // viewer's arrow keys, click halves and auto-advance move `gi` alone, and
    // without this the sidebar overlay's Details tab (which reads this store)
    // would keep describing whichever card was last clicked while the viewer
    // browsed away from it. `fixed`, never `displayed`: a peek is a glance and
    // must not move the selection — that is §8's identity rule, and it is also
    // what would make a pointer sweep across the strip rewrite the sidebar.
    // Keyed on the resolved row rather than on `source` — that object is
    // minted per render, and the row's identity is what actually changes when
    // the answer does (the ResultsSource dependency rule). Idempotent by
    // construction: setItem skips same-file_id writes. Gated on
    // `resultsAreStale` for the gallery's documented reason: an item resolved
    // against the wrong page, published as the selection, makes SearchPage's
    // selection→index effect rewrite `gi` to wherever that item happens to
    // land in the new page — a page-size change would move the position
    // instead of relabelling it.
    const setSelectedItem = useItemSelection((state) => state.setItem)
    useEffect(() => {
        if (!resultsAreStale && fixed) setSelectedItem(fixed)
    }, [fixed, resultsAreStale, setSelectedItem])

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

    // The aspects the shared THUMBNAIL layer has actually PAINTED, keyed by
    // file, and the one piece of state that makes "fixing a peek changes
    // nothing" true for EXIF-rotated pictures.
    //
    // item.width/height are the CODED dimensions — the scanner reads them out
    // of the header and never looks at EXIF orientation
    // (panoptikon/src/jobs/files.rs, image_header_dimensions) — while the
    // browser DOES apply orientation when it paints. A snug box built on the
    // coded numbers is therefore a landscape frame around a portrait photo,
    // which the old full-bounds box hid and this one cannot. So
    // element-confirmed beats item dimensions, the same ladder
    // GalleryImageLarge's mediaAspect walks for its overlays.
    //
    // BOTH subjects report, and — THIS IS THE WHOLE POINT — only through the
    // one element they both paint: `getFileURL(dbs, "thumbnail", "sha256",
    // item.sha256)`. PeekLayer's base layer and GalleryImageLarge's still
    // image build that URL from the same expression against the same
    // `useSelectedDBs()`, so restricting the store to them makes the box
    // agree with the picture BY CONSTRUCTION in either subject, and fixing a
    // peek is a no-op for the picture again.
    //
    // TRAP — "same file" is NOT "same painted image", and a store keyed per
    // file cannot tell the difference. The peek's dwell upgrade loads the
    // ORIGINAL, which the browser rotates per EXIF; GalleryImageLarge paints
    // `thumbnail`, which above the scanner's size thresholds is a STORED
    // thumbnail written by the `image` crate with no EXIF and no orientation
    // applied. Letting the upgrade report — it used to, as an "authoritative"
    // rung that outranked and pinned everything else — fixed the box PORTRAIT
    // around the LANDSCAPE thumbnail the viewer then painted at ~44% of it,
    // permanently, for exactly the gesture §8 exists to make invisible.
    // Accepted in exchange: for a large rotated still the box matches the
    // un-rotated thumbnail both surfaces paint, and only the dwell upgrade
    // letterboxes inside it (the pre-P5 behavior for that case); small files
    // are served directly by the thumbnail endpoint, so their report IS the
    // rotated one and nothing is lost. The class of problem is the scanner
    // storing coded dimensions and un-rotated thumbnails, which is being
    // fixed separately — when thumbnails carry orientation, the two agree
    // everywhere.
    //
    // §8.2 makes element-confirmed-beats-coded normative for the BOX, not
    // merely for the peek, and a viewer reached any way that is not a dwell —
    // arrow keys, the click halves, auto-advance, a scrubber jump, a cold deep
    // link, or a preview-button click faster than the 200ms dwell — never
    // passes through a peek at all. Fitted on the coded numbers, those are
    // exactly the landscape-frame-around-a-portrait-photo the full-bounds box
    // used to hide and this one cannot.
    //
    // What still does NOT report is the <video>'s own onLoadedMetadata aspect
    // (see GalleryImageLarge's prop doc): re-fitting this box the moment
    // metadata lands would re-lay-out a playing element, its surface and its
    // click zones. It costs little to give up: a video the user PRESSES PLAY
    // on showed its thumbnail first, and that report is what the box is fitted
    // with by the time the element mounts. Only a video that mounts straight
    // into S1 (the auto-advance chain) reports nothing at all, and it keeps
    // the coded ratio with the element letterboxed inside — the behavior from
    // before any of this, and preferable to re-fitting a running player.
    //
    // Keyed per FILE rather than per subject, which is what makes fixing a
    // peek a no-op for the picture: the box reuses the aspect it is already
    // fitted with instead of falling back to the coded pair.
    //
    // A small sha-keyed LRU, not a two-slot store. TRAP: keeping only "the
    // record just written and the fixed one" made A→B→peek DROP A's
    // correction, so returning to A rendered the same file at the coded ratio
    // — one file, two shapes, on nothing more than where the pointer had
    // been. The cap is small because a correction is cheap to re-earn (the
    // element re-reports on its next load) and a record for a picture that is
    // not on screen is only ever an optimization; the FIXED subject's record
    // is pinned regardless of age, because losing THAT one resizes the box
    // around a playing video.
    const [confirmed, setConfirmed] = useState<ConfirmedAspect[]>([])
    const fixedSha = fixed?.sha256
    // Precedence is the gallery's plain FIRST WRITER WINS per sha, and it can
    // be, because every writer left is the same URL in a different element:
    // there is nothing here for a second rung to arbitrate. (There WAS one —
    // an `authoritative` flag the dwell upgrade set — and the trap above is
    // the record of why it is gone rather than merely unused.) First-writer
    // also makes the callers idempotent, which they need: every one of them
    // is a ref callback that re-runs on every render which re-creates it.
    const noteAspect = (sha: string, ratio: number) => {
        if (!Number.isFinite(ratio) || ratio <= 0) return
        setConfirmed((prev) => {
            // Returning `prev` UNCHANGED is what makes that idempotence real
            // — React bails out of the re-render on identical state.
            if (prev.some((c) => c.sha === sha)) return prev
            return [
                { sha, ratio },
                // Most-recent-first, dropped from the tail — except the FIXED
                // subject, which never ages out from under the picture it is
                // holding the box open for.
                ...prev.filter((c, i) => i < CONFIRMED_MAX - 1 || c.sha === fixedSha),
            ]
        })
    }

    // The box: the displayed subject's aspect fitted into the shared bounds
    // and capped at natural size. The correction is deliberately late — it
    // cannot arrive before an element has decoded — and that is the trade
    // §8.2 takes: one settle into the right shape beats a permanently wrong
    // frame, and it lands on the same frame as the picture appearing or
    // sharpening.
    const codedRatio =
        displayed?.width && displayed?.height
            ? displayed.width / displayed.height
            : null
    const painted = displayed
        ? confirmed.find((c) => c.sha === displayed.sha256)?.ratio ?? null
        : null
    const ratio =
        painted !== null &&
            codedRatio !== null &&
            Math.abs(painted - codedRatio) > ASPECT_TOLERANCE * codedRatio
            ? painted
            : codedRatio
    const fitted = fittedBoxStyle(ratio, displayed?.width, displayed?.height)
    // May the box ANIMATE into the shape it is changing to? Only when BOTH
    // shapes the swap runs between are fitted ones. `aspect-ratio`
    // interpolates between two ratios and NOT between a ratio and `auto`, so
    // a swap involving §8.2's unprobed fallback (a row from an older scan
    // carries no dimensions, and the box then spans the bounds) animates the
    // width over 150ms while the height jumps in the first frame — a shear,
    // and worse than the honest snap a transitionless swap gives.
    //
    // The shape being animated FROM has to be remembered, and cannot be
    // inferred from the fixed item: peeks are STICKY across the strip
    // (§8.1), so peek→peek with no fixed item in between is the ordinary
    // case while browsing by hover. Adjusted during render — the decision
    // has to survive INTO the commit that applies the new style, which a
    // value recomputed after the state settles would not.
    const [swap, setSwap] = useState({
        sha: displayed?.sha256,
        fitted: !!fitted,
        animate: false,
    })
    if (swap.sha !== displayed?.sha256) {
        setSwap({
            sha: displayed?.sha256,
            fitted: !!fitted,
            animate: swap.fitted && !!fitted,
        })
    }
    // `!!peek` is not redundant with the remembered from-shape: it is what
    // keeps the transition PEEK-ONLY. Without it the box also animates on
    // peek→fixed (the pointer leaving the strip) and on fixed→fixed (the
    // arrow keys, the click halves, a scrubber jump, auto-advance) — 150ms
    // of re-laying-out a frame around a playing <video>, which is the whole
    // thing §8.2's stable bounds exist to prevent. A first computed style
    // never transitions, so the surface's own mount needs no special case.
    const animateSwap = swap.animate && !!peek && !!fitted

    // Nothing on this surface takes input while a peek is displayed. It is a
    // GLANCE: the picture under it belongs to a different file, so a click
    // reaching GalleryImageLarge's navigate halves through the (inert) peek
    // layer would step the viewer for a gesture aimed at something else. The
    // viewer's own state is the only one that earns pointer-events, and a
    // drag ducks even that, for the board underneath (§8.4).
    const interactive = viewerOpen && !peek && !ducked

    return (
        // The bounds are pointer-transparent so the board keeps every click
        // in the letterbox beside a portrait item; only the frame takes
        // events. z-50 alongside the dock, NOT above it: the carry ghost
        // (z-60) still rides above, and body-portaled Radix layers still
        // stack over it by DOM order — the same treatment the dock panel and
        // the fullscreen toolbar get (§7). The two never overlap anyway: the
        // bounds subtract the dock's published height.
        <div
            ref={boundsRef}
            className={cn(
                "pointer-events-none fixed z-50 flex items-center justify-center",
                "transition-opacity duration-100",
                ducked && "opacity-0",
            )}
            style={PREVIEW_BOUNDS}
        >
            {/* data-search-overlay: the maximized board's viewport-marquee
                starter and its click-outside deselect both exempt that
                selector (GalleryPinBoard), so pressing the viewer's header
                neither rubber-bands the board underneath nor clears the pin
                selection (§8.4). Reused rather than a new attribute — it
                keeps both hand-maintained lists short.

                The frame IS the picture: width and aspect on one element, so
                the chrome laid over it has nothing else to line up with, and
                so no chrome can take height out of the fit (§8.3).

                The size transition runs only while a PEEK is displayed, and
                only between two FITTED shapes (see animateSwap). That is the
                one resize §8.4 sanctions, and animating it is what makes the
                box read as following the pointer; on the way BACK the class is
                gone, so revealing the fixed item snaps to its own frame in the
                same commit that uncovers it — one reflow rather than 150ms of
                re-laying-out a playing <video>. */}
            <div
                data-search-overlay
                className={cn(
                    "relative overflow-hidden rounded-md border bg-background shadow-xl",
                    interactive ? "pointer-events-auto" : "pointer-events-none",
                    // `transform` rides along with the width: the sidebar
                    // clearance (previewBox.ts) narrows AND shifts in the
                    // same commit, so animating one without the other would
                    // slide the box instantly and then resize it. Both are
                    // still peek-only (see animateSwap).
                    animateSwap && "transition-[width,aspect-ratio,transform] duration-150 ease-out",
                )}
                // No fit: the subject carries no dimensions (rows from older
                // scans), so the box spans the bounds and object-contain
                // letterboxes — §8.2's unprobed fallback, which carries its
                // own width because it takes the same sidebar clearance the
                // fitted box does.
                style={fitted ?? UNFITTED_BOX_STYLE}
            >
                {/* SLOT ORDER IS LOAD-BEARING. The player is child 0 and the
                    peek child 1, for the whole life of this surface: React
                    reconciles these two by POSITION, so putting the peek
                    first would shift the player's slot every time a pointer
                    crossed a strip card and remount it — a new <video>, from
                    zero, on every glance. That is the exact failure the peek
                    exists as a layer to avoid (§8.4). The peek is opaque and
                    covers it; z-40 puts it over the player surface's own
                    z-20/z-30 chrome. */}
                {viewerOpen && (fixed ? (
                    <GalleryImageLarge
                        item={fixed}
                        prevImage={prevImage}
                        nextImage={nextImage}
                        advanceToNextVideo={advanceToNextVideo}
                        cancelPendingAdvance={NO_PENDING_ADVANCE}
                        // Inert under the height override — they exist
                        // only to build the expression it replaces.
                        thumbnailsOpen={false}
                        showPagination={false}
                        heightClass="absolute inset-0"
                        // This surface owns the picture's top band (the header
                        // below is laid OVER the frame), and its close button
                        // lands on the very corner the player's download
                        // control and its native-controls escape kebab anchor
                        // to. Both were buried — and the kebab is the ONLY way
                        // back out of native controls, so that one trapped the
                        // user in S2 until they closed and reopened the item.
                        // 3.5rem clears the close button's 2.5rem box and the
                        // header's 0.5rem padding with room to spare, and the
                        // two controls are never mounted at once, so one
                        // offset serves both.
                        playerTopRightClass="right-14"
                        // The element-confirmed rung of §8.2's ladder for the
                        // FIXED subject — see `confirmed`. The element
                        // reporting there paints the very same `thumbnail`
                        // URL as the peek's base layer, which is what makes
                        // the two subjects agree about this box.
                        onMediaAspect={noteAspect}
                    />
                ) : (
                    // The gallery's loading frame, verbatim: nothing here
                    // may depend on a row, and nothing may throw waiting
                    // for one.
                    <div className="absolute inset-2 animate-pulse rounded bg-muted" />
                ))}
                {peek && (
                    // Keyed by content: PeekLayer owns the dwell-upgrade
                    // state and moving the hover to another card must reset
                    // it — without the remount, the new item's full file
                    // would render at opacity-100 from byte zero and blank
                    // the box while it loads. The key is on the LAYER, never
                    // on anything the player is inside of.
                    <PeekLayer
                        key={peek.sha256}
                        item={peek}
                        onAspect={noteAspect}
                    />
                )}
                {/* Chrome ON the picture. The LABEL follows whatever is
                    displayed — a peek that told you nothing about the file
                    you are looking at would be a worse peek, and the two
                    subjects are meant to look alike (§8: one surface). The
                    CONTROLS are the part that is fixed-only: during a peek
                    they would act on an item the user is not looking at, and
                    their arrival on click is the signal that the glance
                    became a selection, plus the nudge toward the way out. */}
                {displayed && (
                    <ViewerHeader
                        item={displayed}
                        showControls={viewerOpen && !peek}
                        onClose={onClose}
                    />
                )}
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
// OVERLAID, never a row above the picture. A header in flow takes its height
// out of the fit budget, so the picture re-fitted smaller the instant it
// appeared — the shrink the user rejected. Nothing added here may acquire a
// height the box has to give back.
//
// Legibility over arbitrary picture content follows VideoPlayerSurface's
// idiom rather than a new one: a gradient scrim under white glyphs with a
// drop-shadow, no opaque boxes. And its pointer rule with it — the band is
// pointer-TRANSPARENT and only the controls take events, because the band
// spans the picture's whole top edge and its empty part would otherwise be a
// dead zone over the click-to-navigate half beneath it.
//
// The path sits in the middle track of a symmetric 1fr grid rather than a
// flex `flex-1`, so it is centered on the FRAME, not on whatever space the
// button clusters leave over — the gallery header's flex arrangement is
// balanced only because its two sides carry the same number of controls, and
// this one's never will.
function ViewerHeader({
    item,
    showControls,
    onClose,
}: {
    /** The DISPLAYED subject — the peek when there is one, else the fixed. */
    item: SearchResult
    /** Fixed subject on screen: only then do the controls mean anything. */
    showControls: boolean
    onClose: () => void
}) {
    // The details button points at the SIDEBAR OVERLAY, not the page sidebar
    // — that one is unmounted for the whole maximized session — and it works
    // that out for itself now: the routing lives in useDataViewPane
    // (components/OpenFileDetails.tsx), keyed on pinboardMaximized, so the
    // `target` prop this header used to hand down is gone. It also no longer
    // drives the `gsb` PIN: opening sets the dock's ephemeral open flag (a
    // glance at the data dismisses like any other open dock) and closing
    // clears the pin too, which is what a "Close Data View" press over a
    // PINNED sidebar needs to do to be anything but a dead button (§9.1).
    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/60 to-transparent"
            />
            <div className={cn(
                "relative grid h-12 grid-cols-[1fr_minmax(0,auto)_1fr] items-center px-2",
                "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]",
            )}>
                {/* One control per side, so the two sides weigh the same and
                    the label between them is centered by construction. Close
                    takes the right, where every close in this UI (and every
                    window) lives; the remaining control takes the left rather
                    than doubling up beside it.

                    TRAP: pointer-events-auto goes on the BUTTONS, never on
                    these tracks. The rule is three paragraphs up and the code
                    still broke it: a 1fr track under `justify-items: stretch`
                    is as wide as its third of the frame, so each of these was
                    a ~390x40px opaque slab on a 1200px viewer. That buried the
                    player's own top-right controls (its download control, and
                    the native-controls escape kebab that is the only way back
                    from S2) and killed the top 44px of BOTH click-to-navigate
                    halves — a band the user reads as picture. The middle track
                    already had it right, for the same reason: the empty space
                    beside a control is picture, not chrome. */}
                <div className="col-start-1 flex items-center justify-start">
                    {showControls && <OpenDetailsButton
                        item={item}
                        className="pointer-events-auto text-white hover:bg-white/15 hover:text-white"
                    />}
                </div>
                {/* pointer-events-auto on the label itself and not on its
                    track: the path is a copy-to-clipboard control
                    (FilePathComponent), while the empty space beside it in a
                    1fr grid is picture. Gated on showControls for the same
                    reason the buttons are, and one more: a peek is displayed
                    over a surface the caller has made inert, and a descendant
                    re-enabling pointer events under a `pointer-events-none`
                    ancestor is exactly how a live control ends up floating
                    over the board. The surface's inertness must not depend on
                    the strip clearing the peek in time. */}
                <div className="col-start-2 min-w-0 px-2 text-center">
                    <div className={showControls ? "pointer-events-auto" : undefined}>
                        <FilePathComponent path={item.path} />
                        <p className="text-xs text-white/70 truncate">
                            {getLocale(new Date(item.last_modified))}
                        </p>
                    </div>
                </div>
                <div className="col-start-3 flex items-center justify-end">
                    {showControls && <Button
                        onClick={onClose}
                        variant="ghost"
                        size="icon"
                        title="Close viewer (Esc)"
                        aria-label="Close viewer"
                        className="pointer-events-auto text-white hover:bg-white/15 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </Button>}
                </div>
            </div>
        </div>
    )
}
