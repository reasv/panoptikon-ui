"use client"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { ChevronRight, Pin, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SideBarContent } from "@/components/sidebar/SideBar"
import {
    useSearchOverlayOpen,
    useSearchViewerOpen,
    useSidebarOverlayOpen,
} from "@/lib/state/gallery"
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
// CLICK-TO-OPEN, exactly as the bottom dock, with one difference that is
// the whole point of §9's revision: this dock's edge handle exists ONLY
// WHILE THE BOTTOM SEARCH DOCK IS SHOWN. There is zero reason to reach for
// the screen edge for filters on a cold board — the sidebar makes sense
// beside the search panel (it EDITS the query the panel runs) or as the
// destination of a per-item Data View press, and nothing else. So the three
// edge controls a closed board offers all open the SEARCH dock (§5.1), and
// this handle joins the left edge only once that panel is up, centred in
// the space ABOVE it. The two can never collide: the bottom dock's
// left/right handles hide while its panel is shown, which is exactly when
// this one appears.
//
// The other ways in, both landing on the per-item DATA VIEW tab and neither
// needing the search dock first (§9.1): the viewer header's Data View
// button and a press on an ALREADY-SELECTED item's corner checkbox. Both go
// through useDataViewPane (components/OpenFileDetails.tsx), which is what
// decides between this overlay and the page's own <SideBar/>.
//
// The handle highlights on hover and opens on CLICK. There is no hot band;
// the strip that used to be here sat at z-50 over the board and ate every
// click in the leftmost 16px. Dismissal of an open, unpinned panel: Esc, a
// click outside, or the panel's own X. Pinning: the pin toggle, a
// double-click on genuine panel background (one-way). The bottom dock's
// search-bar row also carries a settings toggle for this panel, but it
// drives OPEN, not the pin (see SearchBarRow) — it is the "show me the
// filters" gesture, not a persistence request. No hotkey: Ctrl+Shift+S is
// the browser's save-page-as and every nearby chord is taken (Ctrl+Shift+F
// opens the bottom dock, Ctrl+Shift+M maximizes), so a keyboard gesture for
// this panel is future work, not a squatted browser chord.
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
export function SidebarOverlay({
    largeImageHosted,
}: {
    /**
     * The ONE prop this dock takes, and only because it cannot compute it:
     * "is the gallery host painting GalleryImageLarge right now" needs the
     * host latch that lives in MultiSearchView (§8.3). It exists here for a
     * single purpose — turning `gsv` into the EFFECTIVE viewer flag for the
     * Esc chain. The hook yields Esc to the viewer, and in the stood-down
     * state there is no PreviewSurface mounted to consume it, so the raw
     * flag left Esc dead for BOTH docks (see useDockDismiss). Passed as a
     * prop rather than published to a store because MultiSearchView already
     * hands the identical value to the bottom dock one line above, and one
     * value with one owner cannot drift; a store would add a second copy
     * whose only job is to agree with the first.
     */
    largeImageHosted: boolean
}) {
    const [pinned, setPinned] = useSidebarOverlayOpen()
    // The BOTTOM dock's show state — the one thing this dock needs to know
    // about the other one, and the gate on this dock's edge handle existing
    // at all (see the header). Same two halves the bottom dock computes for
    // itself: the ephemeral open flag plus the `gso` pin. Two separate
    // hook calls, then the ||: short-circuiting a hook call is a
    // hooks-order bug, so neither may sit on the right of the operator.
    const dockRevealed = useSearchOverlayReveal((s) => s.revealed)
    const dockPinned = useSearchOverlayOpen()[0]
    const dockShown = dockRevealed || dockPinned
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
    // Same effective viewer flag the bottom dock computes, from the same
    // input, for the same reason (see the prop above and useDockDismiss).
    const viewerOpen = useSearchViewerOpen()[0] && !largeImageHosted
    // `[data-opens-data-view]` is THIS dock's exemption and no one else's: a
    // pin's corner checkbox opens the SIDEBAR on a re-click (SelectButton →
    // useDataViewPane), and it lives on the board, not in any dock's chrome.
    // Un-exempted, its press dismissed this panel as an outside click and
    // the button's own handler re-opened it in the same commit — the panel
    // flashing out and back, losing accordion state and scroll and re-firing
    // the tab's fetches every press. Switching the SUBJECT (pressing a
    // DIFFERENT pin's checkbox while the sidebar is up) still works, because
    // exempting the press leaves the button's own handler to re-select and
    // re-open, which is the whole gesture.
    //
    // It was briefly in the SHARED list, and that was a bug of its own: the
    // list feeds both docks, so an unpinned SEARCH dock survived a click on
    // a pin's checkbox while dismissing on a click anywhere else on the same
    // pin — an inconsistency with no explanation available from the UI. A
    // pin button is board, not chrome, for every dock but the one it opens.
    //
    // Deliberately its OWN attribute rather than `data-search-overlay`: that
    // one means "is part of the search chrome" and is consumed by the
    // board's marquee starter and click-outside deselect too, where a pin
    // button emphatically does not belong.
    useDockDismiss(shown, pinned, dismiss, viewerOpen, {
        extraNotOutside: "[data-opens-data-view]",
    })
    useEffect(() => {
        return () => setOpen(false)
    }, [setOpen])

    // --pinboard-left-inset: the band this panel is COVERING right now, the
    // left-edge analog of the bottom dock's --pinboard-bottom-inset. Its
    // consumers — PinboardHistory's tl/bl docking, and the preview surface's
    // minimum-clearance rule (previewBox.ts) — SHOULD reclaim the band the
    // moment the sidebar hides, so this one stays shown-scoped: absence of
    // the var IS "no sidebar shown", with consumers falling back to 0px.
    // NOT consumed by any search gate: this is pure layout yielding.
    //
    // offsetWidth, so the responsive width ladder on the panel below needs
    // nothing here: a viewport resize that crosses a breakpoint resizes the
    // panel, the ResizeObserver fires, and the new width is republished
    // before paint.
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
            {/* The one handle, and it is CONDITIONAL, not merely hidden:
                without the bottom dock on screen there is no sidebar handle
                on the left edge at all (see the header). Rendering it and
                fading it out would leave the DOM node — harmless, but the
                claim being made here is existence, and the bottom dock's
                left handle owns this edge the rest of the time.

                Centred in the space ABOVE the dock, not in the viewport:
                --pinboard-bottom-inset is the band the dock is covering
                right now, published from its ResizeObserver, so this
                tracks the bar rewrapping and the pagination row appearing
                live. The fallback 0px is only ever the frame before the
                var lands, since the handle exists only while the dock —
                the publisher — is shown. It still hides while THIS panel is
                shown, because the panel covers it. */}
            {dockShown && (
                <DockHandle
                    position="left-0 top-[calc((100vh_-_var(--pinboard-bottom-inset,0px))/2)] -translate-y-1/2"
                    shape="h-28 w-4 rounded-r-md border-l-0 hover:w-5 hover:h-32"
                    hidden={shown}
                    onOpen={() => setOpen(true)}
                    title="Open the search filters"
                    label="Open sidebar overlay"
                >
                    <ChevronRight className="h-3 w-3" />
                </DockHandle>
            )}
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
                    // INERT WHILE HIDDEN: opacity + translate +
                    // pointer-events-none hide from the eye and the pointer
                    // but not from the TAB ORDER, and this panel's chrome
                    // (the pin toggle, the close button) is rendered whether
                    // or not the content is. Without this, Tab reached the
                    // invisible pin toggle and Enter popped the sidebar open
                    // from nowhere. Focus and hit-testing only — nothing
                    // about mounting changes.
                    inert={!shown}
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
                    // WIDTH = the page sidebar's rendered width, breakpoint
                    // for breakpoint. That panel (components/sidebar/SideBar.tsx)
                    // is `lg:w-1/2 xl:w-1/3 2xl:w-1/4 4xl:w-[20%] 5xl:w-[18%]`
                    // of a parent that spans the viewport, so the same numbers
                    // are viewport units here — 25vw = 480px at 1920, where the
                    // old flat 26rem was 416px and the item Data View tab
                    // inside it was visibly narrower than the same tab on the
                    // normal page.
                    //
                    // They have to be VIEWPORT units, not percentages: this
                    // panel's parent is the `fixed left-0 top-0 …` wrapper
                    // above, which has no width of its own and shrink-wraps
                    // this child, so a percentage width here resolves against
                    // a containing block that is defined BY it.
                    //
                    // Below `lg` the page sidebar is a Drawer rather than a
                    // panel, so there is no ladder rung to copy: the old flat
                    // width stands, floored by 90vw so a narrow window can
                    // never be covered edge to edge by filters. (Every rung
                    // above is ≤ 50vw, so the floor binds only there.)
                    //
                    // The transition names its properties rather than `all`,
                    // which is what it was while the width was a constant:
                    // with a ladder, `all` animates the WIDTH across a
                    // breakpoint crossing, and this panel's width is
                    // republished as --pinboard-left-inset every frame the
                    // ResizeObserver sees — so a window drag past 1536px
                    // would drive 150ms of re-fitting on the preview box that
                    // consumes it (previewBox.ts). Show/hide is unchanged:
                    // opacity and the -translate-x-2 are the only properties
                    // that ever moved.
                    //
                    // TRAP — the named property is `translate`, NOT
                    // `transform`. Tailwind v4 compiles `-translate-x-2` to
                    // the standalone `translate` property (verified against
                    // the installed tailwindcss: `.-translate-x-2 {
                    // --tw-translate-x: …; translate: var(--tw-translate-x)
                    // var(--tw-translate-y) }`), so naming `transform` left
                    // the slide out of the transition entirely — the opacity
                    // faded over 150ms while the panel SNAPPED sideways. The
                    // bottom dock is not affected: its `translate-y-2` is on
                    // a `transition-all`, which covers both spellings.
                    className={cn(
                        "flex h-full flex-col border-r bg-background/95 shadow-md transition-[opacity,translate] duration-150",
                        "w-[min(26rem,90vw)] lg:w-[50vw] xl:w-[calc(100vw/3)] 2xl:w-[25vw] 4xl:w-[20vw] 5xl:w-[18vw]",
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
