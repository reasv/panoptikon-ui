"use client"
import Link from "next/link"
import { RefreshCw, ScanEye, Settings } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import { SearchBar, TagSearchBar } from "@/components/searchBar"
import { ImageSimilarityHeader } from "@/components/ImageSimilarityHeader"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { SearchMetricsHoverCard } from "@/components/SearchMetricsCard"
import { useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { useSidebarOverlayOpen } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import { components } from "@/lib/panoptikon"

// The search bar row, shared between the page header and the maximized
// board's search overlay (docs/maximized-pinboard-search-overlay-design.md
// §5.2). Everything in it reads and writes only URL params and app-level
// providers (nuqs, react-query, the toaster), so both mounts drive the SAME
// search; what differs is chrome, driven by `variant`:
//
// - The sidebar toggle drives a different surface per mount: `sb` (the page
//   sidebar) on the page, the left-edge sidebar OVERLAY in the overlay —
//   the page sidebar is unmounted while the board is maximized, and `sb`
//   must stay untouched so it returns on restore. In the overlay it writes
//   the sidebar dock's ephemeral OPEN state, NOT its `gsb` pin (design §9):
//   this is the "show me the filters" gesture, not a persistence request,
//   and pinning stays on the panel's own toggle.
// - The scan link is page-only: navigating to the scan page from inside a
//   maximized board is out of place.
// - The overlay appends a compact result count at the row's right edge —
//   the grid header band that normally shows it is not on screen.
export function SearchBarRow({
    variant,
    onRefresh,
    isFetching,
    isRestrictedMode = false,
    scanLink,
    nResults = 0,
    resultMetrics,
    countMetrics,
}: {
    variant: "page" | "overlay"
    onRefresh: () => void
    isFetching: boolean
    /** page only — gates the scan link */
    isRestrictedMode?: boolean
    /** page only — the scan page href */
    scanLink?: string
    /** overlay only — the compact result count at the row's right edge */
    nResults?: number
    resultMetrics?: components["schemas"]["SearchMetrics"]
    countMetrics?: components["schemas"]["SearchMetrics"]
}) {
    const [options] = useQueryOptions()
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    // The sidebar dock's two halves. `shown` is what the toggle reflects —
    // the user asked whether the filters are on screen, and pin vs open is
    // not a distinction the button can usefully draw.
    const [sidebarOverlayPinned, setSidebarOverlayPinned] = useSidebarOverlayOpen()
    const sidebarOverlayOpen = useSearchOverlayReveal((s) => s.sidebarRevealed)
    const setSidebarOverlayOpen = useSearchOverlayReveal((s) => s.setSidebarRevealed)
    const sidebarOverlayShown = sidebarOverlayOpen || sidebarOverlayPinned
    const overlay = variant === "overlay"
    return (
        <div className="flex gap-2">
            <Toggle
                pressed={overlay ? sidebarOverlayShown : sidebarOpen}
                // Opening is purely ephemeral — this gesture never pins.
                // CLOSING does clear the pin as well, and has to: without
                // that, pressing a toggle that reads "pressed" over a PINNED
                // sidebar would write `open = false` under a panel that stays
                // up regardless, i.e. a dead button. Same resolution
                // Ctrl+Shift+F uses for the bottom dock's hide direction.
                onClick={() => {
                    if (!overlay) {
                        void setSideBarOpen(!sidebarOpen)
                        return
                    }
                    setSidebarOverlayOpen(!sidebarOverlayShown)
                    if (sidebarOverlayShown && sidebarOverlayPinned) {
                        void setSidebarOverlayPinned(false)
                    }
                }}
                title={overlay
                    ? (sidebarOverlayShown
                        ? "Hide Advanced Search Options"
                        : "Show Advanced Search Options")
                    : "Advanced Search Options Are " + (sidebarOpen ? "Open" : "Closed")}
                aria-label="Toggle Advanced Search Options"
            >
                <Settings className="h-4 w-4" />
            </Toggle>
            {!overlay && !isRestrictedMode && scanLink != null && <Link href={scanLink}>
                <Button title="File Scan & Indexing" variant="ghost" size="icon">
                    <ScanEye className="h-4 w-4" />
                </Button>
            </Link>}
            {
                options.tag_mode ? <TagSearchBar onSubmit={onRefresh} /> :
                    options.e_iss ? <ImageSimilarityHeader /> : <SearchBar onSubmit={onRefresh} />
            }
            <InstantSearchLock />
            <Toggle title="Refresh search results" onClick={onRefresh} pressed={false}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Toggle>
            {overlay && (
                <div className="flex shrink-0 items-center whitespace-nowrap px-2 text-sm font-medium">
                    <SearchMetricsHoverCard resultMetrics={resultMetrics} countMetrics={countMetrics}>
                        <span><AnimatedNumber value={nResults} /> {nResults === 1 ? "Result" : "Results"}</span>
                    </SearchMetricsHoverCard>
                </div>
            )}
        </div>
    )
}
