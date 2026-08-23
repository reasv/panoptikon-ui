"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronUp, Pin } from "lucide-react"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { SearchBarRow } from "./SearchBarRow"
import { useSearchOverlayOpen } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
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
}: {
    onRefresh: () => void
    isFetching: boolean
    nResults: number
    resultMetrics?: components["schemas"]["SearchMetrics"]
    countMetrics?: components["schemas"]["SearchMetrics"]
}) {
    const [pinned, setPinned] = useSearchOverlayOpen()
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
                </div>
            </div>
        </>
    )
}
