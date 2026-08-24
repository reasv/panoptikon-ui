"use client"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { ChevronRight, Pin, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SideBarContent } from "@/components/sidebar/SideBar"
import { useSidebarOverlayOpen } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import { DockHandle, isPanelBackground, useDockDismiss } from "./dockChrome"

// The maximized board's LEFT-edge sidebar overlay
// (docs/maximized-pinboard-search-overlay-design.md §9): the SearchOverlay
// dock model rotated to the left edge, revealing the search sidebar
// (filters / details / similar items) over the board. Like the bottom dock
// it is search chrome, mounted by MultiSearchView for the whole maximized
// session, and its visibility is its own affair: `shown = open || pinned`,
// where `open` is ephemeral client state and `pinned` is `gsb` in the URL.
//
// CLICK-TO-OPEN, exactly as the bottom dock: ONE always-visible handle on
// the left edge — in the UPPER-middle region, clearly partitioned from the
// bottom dock's low-left handle, which owns the lower region — that
// highlights on hover and opens on CLICK. There is no hot band; the strip
// that used to be here sat at z-50 over the board and ate every click in
// the leftmost 16px. Dismissal of an open, unpinned panel: Esc, a click
// outside, or the panel's own X. Pinning: the pin toggle, a double-click on
// genuine panel background (one-way). The bottom dock's search-bar row also
// carries a settings toggle for this panel, but it drives OPEN, not the pin
// (see SearchBarRow) — it is the "show me the filters" gesture, not a
// persistence request. No hotkey: Ctrl+Shift+S is the browser's
// save-page-as and every nearby chord is taken (Ctrl+Shift+F opens the
// bottom dock, Ctrl+Shift+M maximizes), so a keyboard gesture for this
// panel is future work, not a squatted browser chord.
//
// What is deliberately NOT mirrored from SearchOverlay:
//
// - No search-gate coupling: the sidebar EDITS the query, it does not
//   consume results, so opening it must not enable the suppressed queries —
//   useSearchSuppressed reads the BOTTOM dock's flag only (§9). Filter
//   edits made here write the same URL params as always; whether a query
//   runs is still decided solely by the bottom overlay's open/pin state.
//   The open flag still lives in the shared store rather than in local
//   state, because the bottom dock's search-bar row toggles it.
// - Hiding is NOT CSS-only for the content: SideBarContent is mounted
//   only while `shown` and unmounts on hide. The CSS-only-hide rule
//   (§5.1) exists for HTML5 drag sources, which must survive their own
//   panel hiding mid-drag — the sidebar has none. What it does have is
//   query-running tabs: a hidden-but-mounted Similar Items tab
//   (SimilarItemsView has no `enabled:` gate) would re-run the most
//   expensive query in the app on every strip-card selection change with
//   nothing visible — exactly the behavior the user has ruled against.
//   So visibility-mount wins: zero sidebar queries before the first
//   open AND while hidden after it. Accepted costs: each open remounts
//   the content, re-firing the cheap stats fetches (react-query cache +
//   staleTime soften them) and resetting transient scroll position;
//   accordion open/closed state persists via FilterContainer's
//   localStorage and the active tab via the `sbt` URL param, so the
//   visible state loss is minimal.
export function SidebarOverlay() {
    const [pinned, setPinned] = useSidebarOverlayOpen()
    // The ephemeral OPEN half. In the shared store, not local state, for
    // one reason: SearchBarRow's settings toggle — which lives inside the
    // BOTTOM dock — is the primary way to open this panel, and it cannot
    // reach local state here. Cleared on unmount so restoring the board and
    // re-maximizing starts closed unless `gsb` says otherwise.
    const open = useSearchOverlayReveal((s) => s.sidebarRevealed)
    const setOpen = useSearchOverlayReveal((s) => s.setSidebarRevealed)
    const panelRef = useRef<HTMLDivElement>(null)
    const shown = open || pinned
    const dismiss = useCallback(() => setOpen(false), [setOpen])
    useDockDismiss(shown, pinned, dismiss)
    useEffect(() => {
        return () => setOpen(false)
    }, [setOpen])

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
    // keeps the exemption lists short (§9), and it is also what makes the
    // two docks mutually exempt from each other's outside-click dismissal.
    return (
        <>
            {/* The one handle, in the UPPER third of the left edge. The
                partition is deliberate: the bottom dock's low-left handle
                owns bottom-24, so at 1080p the two sit ~450px apart and
                neither can be mistaken for the other. It hides while the
                panel is shown, since the panel covers it. */}
            <DockHandle
                position="left-0 top-1/3 -translate-y-1/2"
                shape="h-28 w-4 rounded-r-md border-l-0 hover:w-5 hover:h-32"
                hidden={shown}
                onOpen={() => setOpen(true)}
                title="Open the search filters"
                label="Open sidebar overlay"
            >
                <ChevronRight className="h-3 w-3" />
            </DockHandle>
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
                    // Double-click on genuine background pins, one way (the
                    // bottom dock's gesture, same reasoning: the pin toggle
                    // flipping to pressed is the feedback, and the
                    // interactive-ancestor test keeps rapid clicks on the
                    // tab bar or a slider from pinning). Single background
                    // clicks are inert — no auto-pin from pointer or
                    // keyboard anywhere in this dock.
                    onDoubleClick={(e) => {
                        if (pinned || !isPanelBackground(e.target)) return
                        void setPinned(true)
                    }}
                    className={cn(
                        "flex h-full w-[26rem] flex-col border-r bg-background/95 shadow-md transition-all duration-150",
                        shown
                            ? "pointer-events-auto opacity-100 translate-x-0"
                            : "opacity-0 -translate-x-2",
                    )}
                >
                    {/* Slim in-flow header row for the pin and close
                        controls, above the scroll area — the bottom dock
                        keeps its pair in-flow in its own row for the same
                        reason: an absolute right-2 top-2 cluster sat on top
                        of the centered DirectionAwareTabs bar, visually
                        covering (and click-eating) the right end of the tab
                        list.

                        Unpinning leaves the panel OPEN, and closing closes
                        for real (unpinning too) — see the bottom dock's
                        identical pair for why each. The close button has to
                        exist here at all because the edge handle that opens
                        this dock is covered by the open panel. */}
                    <div className="flex shrink-0 justify-end px-2 pt-2">
                        <Toggle
                            data-sidebar-pin-toggle
                            pressed={pinned}
                            onClick={() => {
                                if (pinned) setOpen(true)
                                void setPinned(!pinned)
                            }}
                            title={pinned
                                ? "Pinned: the sidebar survives clicks on the board. Click to unpin — it stays open until Esc or a click outside"
                                : "Pin the sidebar open — unpinned, it closes on Esc or a click outside"}
                            aria-label="Pin sidebar overlay"
                        >
                            <Pin className="h-4 w-4" />
                        </Toggle>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setOpen(false)
                                if (pinned) void setPinned(false)
                            }}
                            title="Close the sidebar (Esc)"
                            aria-label="Close sidebar overlay"
                        >
                            <X className="h-4 w-4" />
                        </Button>
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
