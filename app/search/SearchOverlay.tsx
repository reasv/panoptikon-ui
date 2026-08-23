"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronUp, Pin } from "lucide-react"
import type { ReadonlyURLSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { PageSelect } from "@/components/pageselect"
import { VirtualGalleryHorizontalScroll } from "@/components/gallery/VirtualizedHorizontalScroll"
import { useDelayedHover } from "@/components/gallery/PinboardPreviewPopover"
import { ResultHoverPreview } from "./ResultHoverPreview"
import { SearchBarRow } from "./SearchBarRow"
import { useGalleryNavigate, useSearchOverlayOpen } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import type { ResultsSource } from "@/lib/searchHooks"
import { components } from "@/lib/panoptikon"

// The maximized board's bottom search overlay
// (docs/maximized-pinboard-search-overlay-design.md §5.1). Search chrome,
// not board chrome: it is mounted by MultiSearchView, where every value it
// needs is already in scope, never inside PinBoard — and it mounts for the
// WHOLE maximized session. It is a dock mirroring PinboardFullscreenBar
// flipped to the bottom edge: a hot band along the bottom reveals the panel
// on hover, a grab-handle hints at it while hidden, and the panel is held
// open while the pointer is over it, focus is inside it (typing), or it is
// PINNED (`gso`). Pinning: clicking the hot band, the pin toggle at the
// panel's right edge, Ctrl+Shift+F (registered by MultiSearchView), and
// any pointerdown inside the panel (interacting IS the intent to keep it
// around — and it is what keeps the panel alive when a Radix dropdown
// portals focus out of it).
//
// Hiding is CSS-only (translate/opacity + pointer-events-none): the panel
// and its contents stay MOUNTED for the whole maximized session. This is
// load-bearing, not a styling choice — a drag that starts inside an
// unpinned panel and leaves it hides the panel (deliberately: a drag toward
// the board is exactly when the panel should get out of the drop's way),
// and a P2 strip card serving as the HTML5 drag source must survive its own
// panel hiding mid-drag. Never convert the hide to a conditional unmount
// (design §5.1, "Drags are not held").
//
// Pointer-events follow the toolbar's SHOW pattern only: the hidden panel
// is pointer-events-none (an invisible fixed panel must not eat board
// clicks near the bottom edge) and becomes interactive when shown. What is
// NOT replicated is the toolbar's always-auto piercing of modal-locked
// bodies and the exclusive-menu-slot machinery it necessitates: auto-pin on
// interaction makes a panel with an open menu pinned by construction, so
// Radix modal layers may disable it along with the rest of the body while a
// menu is open — correct dismiss behavior. Menus inside the overlay work
// exactly as they do on the normal page (§5.1).
export function SearchOverlay({
    onRefresh,
    isFetching,
    nResults,
    resultMetrics,
    countMetrics,
    source,
    count,
    scrollMode,
    fallbackAnchor,
    onDerivedPageChange,
    pageSize,
    totalPages,
    currentPage,
    setPage,
    getPageURL,
}: {
    onRefresh: () => void
    isFetching: boolean
    nResults: number
    resultMetrics?: components["schemas"]["SearchMetrics"]
    countMetrics?: components["schemas"]["SearchMetrics"]
    /** The same rows grid and gallery read — see ResultsSource. */
    source: ResultsSource
    /** The navigable extent — MultiSearchView's itemCount. */
    count: number
    /** `vm === "scroll"` — gates the anchor half of useGalleryNavigate. */
    scrollMode: boolean
    /**
     * Scroll mode: the grid scroll anchor, so a scrubber click with `gi`
     * null still moves the strip (design §5.3 — `setVirtualPage` keeps `gi`
     * null while the gallery is closed, so `top` is the only position the
     * click writes). Null in pages mode, where `top` is a within-page index
     * the grid owns and means nothing to the strip.
     */
    fallbackAnchor: number | null
    /**
     * Scroll mode: the host's setDerivedPage, stable by construction (a
     * useState setter) — the strip's scroll listener depends on it (§6).
     */
    onDerivedPageChange?: (page: number) => void
    /** k, the virtual-page size, for the strip's derived page number. */
    pageSize: number
    // The pagination row: the exact four-prop switch MultiSearchView already
    // computes for the page-level bar (design §5.4) —
    // totalPages/currentPage/setPage/getPageURL in pages mode,
    // scrollTotalPages/derivedPage/setVirtualPage/getVirtualPageURL in
    // scroll mode. Only one PageSelect is ever on screen: the page-level bar
    // is gated `!fs`, and this overlay only mounts while maximized.
    totalPages: number
    currentPage: number
    setPage: (page: number) => void
    getPageURL: (base: ReadonlyURLSearchParams | URLSearchParams, newPage: number) => string
}) {
    const [pinned, setPinned] = useSearchOverlayOpen()
    // The strip's card clicks perform the GALLERY's position write — `gi`
    // plus, in scroll mode, the anchor ("the anchor follows the position") —
    // through the same shared hook the gallery uses, so the two mounts
    // cannot drift (design §5.3). Writing `gi` is safe mid-maximize: the
    // host choice is latched while maximized (see galleryHost in
    // MultiSearchView), so the selection cannot flip hosts under the board.
    const navigate = useGalleryNavigate(scrollMode)
    const [hoverBand, setHoverBand] = useState(false)
    const [hoverPanel, setHoverPanel] = useState(false)
    // Focus inside the panel holds it open so it cannot vanish mid-typing.
    // Tracked with capture-phase focus/blur (focus events don't bubble);
    // blur only clears it when focus actually LEFT the panel container —
    // relatedTarget is the element gaining focus, and a move between two
    // controls inside the panel must not blink the hold off.
    const [focusWithin, setFocusWithin] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const shown = hoverBand || hoverPanel || focusWithin || pinned

    // The hover preview's subject (design §8): the strip card under the
    // pointer, debounced 200ms on open so a sweep across cards doesn't
    // flash a preview per card, cleared instantly on leave — the same
    // useDelayedHover the pinboard preview popovers use. The strip's
    // onItemHover contract also feeds null on a card's own dragstart (the
    // z-70 preview would occlude the drag toward the board). Passing the
    // setter directly is deliberate: it is stable (useCallback inside the
    // hook) and its (item | null) shape is assignable to the strip's
    // (item | null, index) callback.
    const [hoverItem, setHoverItem] = useDelayedHover<SearchResult>(200)
    // Panel hide clears the preview too (§8 "cleared on overlay close").
    // Leaving a card fires its own mouseleave before the panel's on any
    // pointer path, so this is the net for hide paths where no card
    // mouseleave is delivered — e.g. a drag that exits an unpinned panel
    // (HTML5 drags suppress mouse events; dragstart already cleared it,
    // this keeps the invariant if that ever changes). A hidden panel with
    // a live full-viewport preview stranded over the board is never
    // acceptable, so the clear keys on the show-state itself.
    useEffect(() => {
        if (!shown) setHoverItem(null)
    }, [shown, setHoverItem])

    // Mirror the show-state into the ephemeral reveal store, which is the
    // client-only half of useSearchSuppressed: a hover-revealed overlay is
    // a search consumer on screen and enables the query exactly like a
    // pinned one (design §2/§4). From an effect, never during render (store
    // writes are side effects); cleared on unmount so a restored board
    // never inherits a stale "revealed".
    const setRevealed = useSearchOverlayReveal((s) => s.setRevealed)
    useEffect(() => {
        setRevealed(shown)
        return () => setRevealed(false)
    }, [shown, setRevealed])

    // While SHOWN, the overlay publishes its height as
    // --pinboard-bottom-inset on the document root, so the bottom-band
    // occupants that would otherwise sit under it (PinboardHistory's bottom
    // docking, the hole-mode hint toast) can add the inset to their bottom
    // offsets (design §7). Measured with a ResizeObserver rather than a
    // one-shot: later phases add the thumbnail strip and pagination rows,
    // and the var must track the panel as it grows. Only while shown — the
    // dock now mounts for the whole maximized session, so mere mountedness
    // means nothing; a hidden panel occupies no band, and absence of the
    // var IS "no overlay shown", with consumers falling back to 0px.
    useLayoutEffect(() => {
        if (!shown) return
        const el = panelRef.current
        if (!el) return
        const publish = () =>
            document.documentElement.style.setProperty(
                "--pinboard-bottom-inset",
                `${el.offsetHeight}px`
            )
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(el)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty(
                "--pinboard-bottom-inset"
            )
        }
    }, [shown])

    // All three fixed elements carry data-search-overlay: the maximized
    // board's viewport-marquee starter and click-outside deselect both
    // exempt that selector (GalleryPinBoard), so a press on the dock never
    // rubber-bands the board underneath or clears the pin selection.
    return (
        <>
            {/* The hot band: the bottom-edge analog of the fullscreen
                toolbar's top band. While the panel is shown it is occluded
                by it (the panel renders later at the same z and is far
                taller), so in practice the band's click pins from the
                hidden state — a click, not a hover, is the deliberate
                pin gesture; unpinning happens via the pin toggle,
                Ctrl+Shift+F or Back. */}
            <div
                data-search-overlay
                className="fixed inset-x-0 bottom-0 z-50 h-4"
                onMouseEnter={() => setHoverBand(true)}
                onMouseLeave={() => setHoverBand(false)}
                onClick={() => setPinned(true)}
            />
            {/* The handle: a permanent hint that the search dock lives down
                here, fading out while the panel itself is shown — the
                toolbar's top-center handle upside down */}
            <div
                data-search-overlay
                className="fixed bottom-0 left-1/2 z-50 -translate-x-1/2 pointer-events-none"
            >
                <div
                    className={cn(
                        "flex h-4 w-28 items-center justify-center rounded-t-md border border-b-0 bg-muted text-muted-foreground shadow-sm transition-opacity duration-150",
                        shown ? "opacity-0" : "opacity-100",
                    )}
                >
                    <ChevronUp className="h-3 w-3" />
                </div>
            </div>
            {/* pointer-events-none on the wrapper, re-enabled on the panel
                only while shown — the toolbar's show pattern with the
                translate direction flipped for a bottom edge */}
            <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
                <div
                    ref={panelRef}
                    data-search-overlay
                    onMouseEnter={() => setHoverPanel(true)}
                    onMouseLeave={() => setHoverPanel(false)}
                    onFocusCapture={() => setFocusWithin(true)}
                    onBlurCapture={(e) => {
                        const next = e.relatedTarget as Node | null
                        if (!next || !panelRef.current?.contains(next)) {
                            setFocusWithin(false)
                        }
                    }}
                    // Auto-pin: interacting with the search UI IS the intent
                    // to keep it around — and this is what keeps the panel
                    // alive when a Radix dropdown portals focus out of it
                    // (design §5.1). The pin toggle is the one exception:
                    // without it, pressing the toggle while unpinned would
                    // auto-pin on pointerdown and the click's own toggle
                    // would immediately unpin — a no-op button.
                    onPointerDownCapture={(e) => {
                        if (
                            e.target instanceof Element &&
                            e.target.closest("[data-overlay-pin-toggle]")
                        ) {
                            return
                        }
                        if (!pinned) setPinned(true)
                    }}
                    className={cn(
                        "border-t bg-background/95 px-4 py-3 shadow-md transition-all duration-150",
                        shown
                            ? "pointer-events-auto opacity-100 translate-y-0"
                            : "opacity-0 translate-y-2",
                    )}
                >
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <SearchBarRow
                                variant="overlay"
                                onRefresh={onRefresh}
                                isFetching={isFetching}
                                nResults={nResults}
                                resultMetrics={resultMetrics}
                                countMetrics={countMetrics}
                            />
                        </div>
                        {/* Unpinning while the pointer is still inside does
                            not hide the panel — hoverPanel keeps `shown`
                            true and it hides on the next leave, per the
                            show-state formula above. The blur on unpin is
                            load-bearing: Chromium focuses the button on
                            mousedown, so after unpinning the button's own
                            focus would hold `focusWithin` (and thus the
                            panel) — and no click on the maximized board can
                            ever blur it, because both marquee starters in
                            GalleryPinBoard preventDefault() on pointerdown
                            (suppressing the default focus change) and pins
                            aren't focusable. Blurring here (relatedTarget
                            null → focusWithin false in onBlurCapture) makes
                            "hides on the next pointer leave" actually
                            reachable by mouse. */}
                        <Toggle
                            data-overlay-pin-toggle
                            pressed={pinned}
                            onClick={(e) => {
                                if (pinned) e.currentTarget.blur()
                                setPinned(!pinned)
                            }}
                            title={pinned
                                ? "Pinned (Ctrl+Shift+F): the search overlay stays open. Click to unpin — it hides when the pointer leaves"
                                : "Pin the search overlay open (Ctrl+Shift+F) — unpinned, it hides when the pointer leaves"}
                            aria-label="Pin search overlay"
                        >
                            <Pin className="h-4 w-4" />
                        </Toggle>
                    </div>
                    {/* The thumbnail strip (design §5.3). Mounted for the
                        whole maximized session like the rest of the panel —
                        hiding is CSS-only, so a card serving as the HTML5
                        drag source survives its own panel hiding mid-drag
                        (§5.1). Drag-out, PinButton and shift-carry need no
                        overlay code: cards already set the sha256 +
                        text/uri-list payload, and the maximized board above
                        is the mounted RGL drop target. While search is
                        suppressed (hidden, unpinned, unrevealed) the strip
                        is inert by construction: its ensureRange calls flow
                        into useChunkedResults, whose queries are
                        `enabled: false` then — wanted chunks accumulate
                        under the disabled placeholder key but nothing
                        fetches, and the first enabled render rebuilds the
                        wanted window from the visible range. */}
                    <div className="mt-2">
                        <VirtualGalleryHorizontalScroll
                            source={source}
                            count={count}
                            onNavigate={navigate}
                            fallbackAnchor={fallbackAnchor}
                            onDerivedPageChange={onDerivedPageChange}
                            pageSize={pageSize}
                            onItemHover={setHoverItem}
                        />
                    </div>
                    {/* The pagination row: with `gi` set, a scrubber click
                        moves the gallery position to the target page's first
                        item (setVirtualPage); with `gi` null it writes only
                        the anchor, and the strip follows via fallbackAnchor
                        while the highlight converges through the strip's own
                        live push (§5.4). Gated like the page-level bar's
                        content test: one page means nothing to flip or
                        scrub. */}
                    {totalPages > 1 && (
                        <PageSelect
                            totalPages={totalPages}
                            currentPage={currentPage}
                            setPage={setPage}
                            getPageURL={getPageURL}
                        />
                    )}
                </div>
            </div>
            {/* The hover preview (design §8): mounted ONLY while a card is
                hovered — no idle portal — replacing the gallery's
                large-image role over the maximized board. Its own file owns
                the box, layering and dwell upgrade. */}
            {hoverItem && <ResultHoverPreview item={hoverItem} />}
        </>
    )
}
