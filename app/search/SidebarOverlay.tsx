"use client"
import { useLayoutEffect, useRef, useState } from "react"
import { ChevronRight, Pin } from "lucide-react"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SideBarContent } from "@/components/sidebar/SideBar"
import { useSidebarOverlayOpen } from "@/lib/state/gallery"

// The maximized board's LEFT-edge sidebar overlay
// (docs/maximized-pinboard-search-overlay-design.md §9): the SearchOverlay
// dock model rotated to the left edge, revealing the search sidebar
// (filters / details / similar items) over the board. Like the bottom dock
// it is search chrome, mounted by MultiSearchView for the whole maximized
// session; visibility (hidden, hover-revealed, pinned `gsb`) is the dock's
// own affair. The pin gestures are the bottom dock's: clicking the hot
// band, the pin toggle in the panel, and any pointerdown inside the panel
// (interacting IS the intent to keep it around — and what keeps the panel
// alive when a Radix dropdown portals focus out of it). No hotkey:
// Ctrl+Shift+S is the browser's save-page-as and every nearby chord is
// taken (Ctrl+Shift+F pins the bottom dock, Ctrl+Shift+M maximizes), so a
// keyboard pin for this panel is future work, not a squatted browser chord.
//
// What is deliberately NOT mirrored from SearchOverlay:
//
// - No reveal store and no search-gate coupling: the sidebar EDITS the
//   query, it does not consume results, so revealing it must not enable
//   the suppressed queries — useSearchSuppressed stays `gso`-only (§9).
//   Filter edits made here write the same URL params as always; whether a
//   query runs is still decided solely by the bottom overlay's pin/reveal.
// - Hiding is NOT CSS-only for the content: SideBarContent is mounted
//   only while `shown` and unmounts on hide. The CSS-only-hide rule
//   (§5.1) exists for HTML5 drag sources, which must survive their own
//   panel hiding mid-drag — the sidebar has none. What it does have is
//   query-running tabs: a hidden-but-mounted Similar Items tab
//   (SimilarItemsView has no `enabled:` gate) would re-run the most
//   expensive query in the app on every strip-card selection change with
//   nothing visible — exactly the behavior the user has ruled against.
//   So visibility-mount wins: zero sidebar queries before the first
//   reveal AND while hidden after it. Accepted costs: each reveal
//   remounts the content, re-firing the cheap stats fetches (react-query
//   cache + staleTime soften them) and resetting transient scroll
//   position; accordion open/closed state persists via FilterContainer's
//   localStorage and the active tab via the `sbt` URL param, so the
//   visible state loss is minimal.
export function SidebarOverlay() {
    const [pinned, setPinned] = useSidebarOverlayOpen()
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

    // --pinboard-left-inset: the band this panel is COVERING right now, the
    // left-edge analog of the bottom dock's --pinboard-bottom-inset. Its
    // consumer — PinboardHistory's tl/bl docking — SHOULD reclaim the band
    // the moment the sidebar hides,
    // so this one stays shown-scoped: absence of the var IS "no sidebar
    // shown", with consumers falling back to 0px. NOT consumed by any search
    // gate: this is pure layout yielding.
    useLayoutEffect(() => {
        if (!shown) return
        const el = panelRef.current
        if (!el) return
        const publish = () =>
            document.documentElement.style.setProperty(
                "--pinboard-left-inset",
                `${el.offsetWidth}px`
            )
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(el)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty(
                "--pinboard-left-inset"
            )
        }
    }, [shown])

    // All fixed elements carry data-search-overlay: the maximized board's
    // viewport-marquee starter and click-outside deselect both exempt that
    // selector (GalleryPinBoard) — reusing the bottom dock's attribute
    // keeps the exemption lists short (§9).
    return (
        <>
            {/* The hot band: the left-edge analog of the bottom dock's
                band. Vertically inset top-4 bottom-4 so the corners stay
                with their horizontal owners — the fullscreen toolbar's top
                band and the search overlay's bottom band each claim the
                full viewport width, and two hot bands meeting in a corner
                would make the corner pixel reveal both panels at once. The
                bottom inset additionally yields to the SHOWN search
                overlay panel (which is far taller than its band): this
                band renders after it in DOM order at the same z, so
                without the retreat its 1rem-wide strip would eat the
                bottom panel's left-edge clicks. While the sidebar panel is
                shown the band is occluded by it, so in practice the band's
                click pins from the hidden state — a click, not a hover, is
                the deliberate pin gesture. */}
            <div
                data-search-overlay
                className="fixed left-0 top-4 bottom-[calc(1rem+var(--pinboard-bottom-inset,0px))] z-50 w-4"
                onMouseEnter={() => setHoverBand(true)}
                onMouseLeave={() => setHoverBand(false)}
                onClick={() => setPinned(true)}
            />
            {/* The handle: a permanent hint that the sidebar dock lives at
                the left edge, fading out while the panel itself is shown —
                the bottom dock's handle rotated a quarter turn */}
            <div
                data-search-overlay
                className="fixed left-0 top-1/2 z-50 -translate-y-1/2 pointer-events-none"
            >
                <div
                    className={cn(
                        "flex h-28 w-4 items-center justify-center rounded-r-md border border-l-0 bg-muted text-muted-foreground shadow-sm transition-opacity duration-150",
                        shown ? "opacity-0" : "opacity-100",
                    )}
                >
                    <ChevronRight className="h-3 w-3" />
                </div>
            </div>
            {/* pointer-events-none on the wrapper, re-enabled on the panel
                only while shown — the bottom dock's show pattern with the
                translate direction flipped for a left edge. The wrapper
                stops at var(--pinboard-bottom-inset): the search overlay
                owns the bottom band while IT is shown, and the two panels
                overlapping in the corner would stack the sidebar over the
                strip's leftmost cards (both z-50, this one later in DOM).
                Hidden, the var is absent and the sidebar runs full
                height. */}
            <div
                className="fixed left-0 top-0 bottom-[var(--pinboard-bottom-inset,0px)] z-50 pointer-events-none"
            >
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
                    // Auto-pin: interacting with the sidebar IS the intent
                    // to keep it around — and this is what keeps the panel
                    // alive when a Radix dropdown portals focus out of it
                    // (§5.1 via §9). The pin toggle is the one exception:
                    // without it, pressing the toggle while unpinned would
                    // auto-pin on pointerdown and the click's own toggle
                    // would immediately unpin — a no-op button.
                    // data-sidebar-pin-toggle, not data-overlay-pin-toggle:
                    // that attribute belongs to the bottom dock's button,
                    // and sharing it would let either panel's pointerdown
                    // filter match the other's toggle.
                    onPointerDownCapture={(e) => {
                        if (
                            e.target instanceof Element &&
                            e.target.closest("[data-sidebar-pin-toggle]")
                        ) {
                            return
                        }
                        if (!pinned) setPinned(true)
                    }}
                    className={cn(
                        "flex h-full w-[26rem] flex-col border-r bg-background/95 shadow-md transition-all duration-150",
                        shown
                            ? "pointer-events-auto opacity-100 translate-x-0"
                            : "opacity-0 -translate-x-2",
                    )}
                >
                    {/* Slim in-flow header row for the pin toggle, above
                        the scroll area — the bottom dock keeps its pin
                        toggle in-flow in its own row for the same reason:
                        an absolute right-2 top-2 toggle sat on top of the
                        centered DirectionAwareTabs bar, visually covering
                        (and click-eating) the right end of the tab list.

                        Unpinning while the pointer is still inside does not
                        hide the panel — hoverPanel keeps `shown` true and
                        it hides on the next leave, per the show-state
                        formula above. The blur on unpin is load-bearing:
                        Chromium focuses the button on mousedown, so after
                        unpinning the button's own focus would hold
                        `focusWithin` (and thus the panel) — and no click on
                        the maximized board can ever blur it, because both
                        marquee starters in GalleryPinBoard preventDefault()
                        on pointerdown (suppressing the default focus
                        change) and pins aren't focusable. Blurring here
                        (relatedTarget null → focusWithin false in
                        onBlurCapture) makes "hides on the next pointer
                        leave" actually reachable by mouse. */}
                    <div className="flex shrink-0 justify-end px-2 pt-2">
                        <Toggle
                            data-sidebar-pin-toggle
                            pressed={pinned}
                            onClick={(e) => {
                                if (pinned) e.currentTarget.blur()
                                setPinned(!pinned)
                            }}
                            title={pinned
                                ? "Pinned: the sidebar stays open. Click to unpin — it hides when the pointer leaves"
                                : "Pin the sidebar open — unpinned, it hides when the pointer leaves"}
                            aria-label="Pin sidebar overlay"
                        >
                            <Pin className="h-4 w-4" />
                        </Toggle>
                    </div>
                    {/* Content mounts only while shown (see the header
                        comment): unmounting on hide is what guarantees a
                        hidden Similar Items tab cannot keep querying. */}
                    <ScrollArea className="min-h-0 flex-1 px-4 py-3">
                        {shown && <SideBarContent closeButton={false} />}
                    </ScrollArea>
                </div>
            </div>
        </>
    )
}
