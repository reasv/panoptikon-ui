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
import { components } from "@/lib/panoptikon"

// The search bar row, shared between the page header and the maximized
// board's search overlay (docs/maximized-pinboard-search-overlay-design.md
// §5.2). Everything in it reads and writes only URL params and app-level
// providers (nuqs, react-query, the toaster), so both mounts drive the SAME
// search; what differs is chrome, driven by `variant`:
//
// - The sidebar toggle is page-only: the page sidebar is hidden while the
//   board is maximized, so in the overlay the toggle would flip a control
//   with nothing to show. P4 wires an overlay-sidebar flag (gsb) here.
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
    const overlay = variant === "overlay"
    return (
        <div className="flex gap-2">
            {!overlay && <Toggle
                pressed={sidebarOpen}
                onClick={() => setSideBarOpen(!sidebarOpen)}
                title={"Advanced Search Options Are " + (sidebarOpen ? "Open" : "Closed")}
                aria-label="Toggle Advanced Search Options"
            >
                <Settings className="h-4 w-4" />
            </Toggle>}
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
