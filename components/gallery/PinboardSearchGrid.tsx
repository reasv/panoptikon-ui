'use client'

import { useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import { $api, fetchClient } from "@/lib/api"
import { components } from "@/lib/panoptikon"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSelectedDBs } from "@/lib/state/database"
import { useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { useClientConfig } from "@/lib/useClientConfig"
import { useThrottledValue } from "@/lib/useThrottledValue"
import {
    buildPinboardSearchRequest,
    SearchRequestParts,
} from "@/lib/searchRequest"
import { usePinboardActions } from "@/lib/pinboardSave"
import { pinboardOpenHref } from "@/lib/pinboardLinks"
import { usePinboardCleanLinks } from "@/lib/state/pinboardLibraryPrefs"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import { PinboardCard, PinboardPreviewDialog } from "./PinboardLibrary"
import {
    PreviewPopover,
    useDelayedHover,
    verticalPopoverBox,
} from "./PinboardPreviewPopover"

// These cards span a whole search panel, so they are several times the size
// of the library dialog's — a 320px preview visibly stretches here. The
// master is 2048 wide, so this is a real resolution gain, not an upscale.
const SEARCH_CARD_PREVIEW_WIDTH = 768

type PinboardMatch = components["schemas"]["PinboardSearchMatch"]
// What PinboardCard hands back to its hover/preview callbacks: the match rows
// are this shape plus match_count, and neither the popover nor the preview
// dialog reads the extra field.
type PinboardSummary = components["schemas"]["PinboardSummaryResponse"]

/**
 * The grid view's Library tab: the saved pinboards whose pinned images match
 * the current search, best match first (the server orders them — render in
 * response order).
 *
 * Mounted only while the tab is showing, which is what scopes the query: the
 * intersection costs about what the search's count query costs, so it must
 * not run for a tab nobody is looking at.
 *
 * That on-demand mount is also why `committedQuery` is a prop. The update
 * lock is a render-time comparison against a ref, and a ref belonging to a
 * component that mounts when the tab is selected starts out agreeing with
 * whatever the sidebar currently says — so deriving the lock here would run
 * the uncommitted query, the one thing the lock exists to prevent. The
 * always-mounted `useSearch` owns that decision and hands down the query it
 * would itself run.
 */
export function PinboardSearchGrid({
    committedQuery,
    showPagination = true,
    updateRibbonVisible = false,
}: {
    committedQuery: Pick<SearchRequestParts, "searchQuery" | "dbs">
    showPagination?: boolean
    updateRibbonVisible?: boolean
}) {
    const dbs = useSelectedDBs()[0]
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { loadBoard } = usePinboardActions()
    const { toast } = useToast()
    const [cleanLinks] = usePinboardCleanLinks()
    const [previewBoard, setPreviewBoard] = useState<PinboardMatch | null>(null)
    const [hovered, setHovered] = useDelayedHover<{
        board: PinboardSummary
        anchor: DOMRect
    }>(100)

    const searchEnabled = useQueryOptions()[0].s_enable
    const { data: clientConfig } = useClientConfig()
    const throttleMs = clientConfig?.searchThrottleMs ?? 500
    // Throttled exactly like the results and count queries — this is the same
    // search, so typing must not fire one request per keystroke. The
    // instant-search lock is already applied to `committedQuery` upstream, so
    // what is throttled here is a value that simply stops moving while the
    // lock withholds: the tab then shows the boards for the query the Results
    // tab is showing rows for.
    const throttledRequest = useThrottledValue(committedQuery, throttleMs)
    const request = throttleMs > 0 ? throttledRequest : committedQuery

    const queryEnabled =
        searchEnabled && clientConfig?.pinboardSearchEnabled === true
    const { data, isError, isFetching, isPlaceholderData, refetch } = $api.useQuery(
        "post",
        "/api/pinboards/search",
        { ...buildPinboardSearchRequest(request) },
        { enabled: queryEnabled, placeholderData: keepPreviousData }
    )
    const boards = data?.pinboards ?? []
    // The fetching guard is what the results path needs too (see
    // resultsAreStale in lib/searchHooks.ts): a disabled query still swaps to
    // placeholder data when its key changes, and with nothing in flight it
    // stays there — leaving the grid dimmed forever.
    const showingPrevious = isPlaceholderData && (queryEnabled || isFetching)

    const openBoard = async (board: PinboardMatch) => {
        const { data: detail } = await fetchClient.GET(
            "/api/pinboards/{pinboard_id}",
            { params: { path: { pinboard_id: board.id }, query: { ...dbs } } }
        )
        if (!detail?.head) {
            toast({ title: "Error", description: "Board has no saved version" })
            return
        }
        // Also clears the Library tab flag — see loadBoard
        loadBoard(board.id, detail.head.layout, detail.flags)
    }

    // The same fixed heights as the result grid and the board tab, so
    // switching tabs never resizes the panel
    const heightClass = showPagination
        ? (updateRibbonVisible ? 'h-[calc(100vh-261px)]' : 'h-[calc(100vh-213px)]')
        : (updateRibbonVisible ? 'h-[calc(100vh-199px)]' : 'h-[calc(100vh-151px)]')

    return (
        <>
            {isError ? (
                // Inline rather than the results tab's SearchErrorToast: that
                // one is a toast driven by the search's own error object and
                // its dismissal state, and the panel body is empty here
                // anyway. A failed intersection must not read as "no boards
                // match" — nor sit on "Searching pinboards…" forever.
                <div
                    className={cn(
                        "flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground",
                        heightClass
                    )}
                >
                    <span>Pinboard search failed</span>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="underline underline-offset-4 hover:text-foreground cursor-pointer"
                    >
                        Try again
                    </button>
                </div>
            ) : boards.length > 0 ? (
                <ScrollArea
                    className={cn('w-full rounded-[inherit]', heightClass)}
                    onScrollCapture={() => setHovered(null)}
                >
                    <div
                        className={cn(
                            "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 items-start gap-3 p-1",
                            // Results for the previous query while the new one
                            // is in flight
                            showingPrevious && "opacity-60"
                        )}
                    >
                        {boards.map((board) => (
                            <PinboardCard
                                key={board.id}
                                board={board}
                                dbs={dbs}
                                matchCount={board.match_count}
                                previewWidth={SEARCH_CARD_PREVIEW_WIDTH}
                                href={pinboardOpenHref(
                                    pathname,
                                    searchParams,
                                    board.id,
                                    "head",
                                    cleanLinks ? "clean" : "carry"
                                )}
                                onOpen={() => openBoard(board)}
                                onPreview={() => {
                                    setHovered(null)
                                    setPreviewBoard(board)
                                }}
                                onHover={(b, anchor) =>
                                    setHovered(b && anchor ? { board: b, anchor } : null)
                                }
                            />
                        ))}
                    </div>
                </ScrollArea>
            ) : (
                // Outside the ScrollArea: Radix's table-display viewport
                // defeats h-full centering (same split as the library dialog)
                <div
                    className={cn(
                        "flex items-center justify-center p-8 text-sm text-muted-foreground",
                        heightClass
                    )}
                >
                    {data != null
                        ? "No pinboards contain matching images"
                        : // Nothing fetched yet — and nothing on the way when
                          // the query is withheld (invalid input, no pinboard
                          // read access), so promise nothing then
                          queryEnabled
                          ? "Searching pinboards…"
                          : null}
                </div>
            )}
            {hovered && hovered.board.head_version_id != null && (
                <PreviewPopover
                    src={pinboardPreviewURL(
                        dbs,
                        hovered.board.id,
                        hovered.board.head_version_id
                    )}
                    box={verticalPopoverBox(
                        hovered.anchor,
                        hovered.board.preview_w ?? 1,
                        hovered.board.preview_h ?? 1
                    )}
                />
            )}
            <PinboardPreviewDialog
                board={previewBoard}
                dbs={dbs}
                onClose={() => setPreviewBoard(null)}
            />
        </>
    )
}
