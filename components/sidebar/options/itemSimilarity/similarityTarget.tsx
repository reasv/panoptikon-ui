import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query";
import { downloadFileName, getFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { SearchResultImage } from "@/components/SearchResultImage";
import { Button } from "@/components/ui/button";
import { useItemSelection } from "@/lib/state/itemSelection";
import { useItemSimilaritySearch, useSearchPage } from "@/lib/state/searchQuery/clientHooks";
import { FilterContainer } from "../../base/FilterContainer";
import { tierForCellWidth } from "@/lib/thumbnailTier";
import { useDevicePixelRatio } from "@/hooks/useDevicePixelRatio";

// The nominal CSS width of this ONE card, which spans the sidebar's whole
// content width (grid-cols-1): ~350px at a 1280px window, ~700px at 4K. The
// same nominal-rather-than-measured call as SimilarItemsView's, for the same
// reason — a single card behind a collapsible panel.
const TARGET_CARD_CSS_WIDTH = 700

export function SimilarityTarget() {
    const selected = useItemSelection((state) => state.getSelected())
    const [dbs, ___] = useSelectedDBs()
    const cardTier = tierForCellWidth(TARGET_CARD_CSS_WIDTH, useDevicePixelRatio())
    const [filter, setFilter] = useItemSimilaritySearch()
    const [page, setPage] = useSearchPage()
    const currentTargetExists = filter.target.length > 0
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: filter.target,
                id_type: "sha256",
            }
        }
    },
        {
            placeholderData: keepPreviousData,
            enabled: currentTargetExists
        })
    const sizeString = data ? prettyPrintBytes(data.item.size || 0) : 0
    const resolutionString = data && data.item.width && data.item.height ? `${data.item.width}x${data.item.height}` : null
    const timeAddedString = data ? getLocale(new Date(data.item.time_added)) : null
    const durationString = data && data.item.duration ? prettyPrintVideoDuration(data.item.duration) : null
    const item = data?.item
    const file = data?.files[0]
    const resultItem = {
        sha256: filter.target,
        last_modified: file?.last_modified || "1970-09-02T14:30:00Z",
        path: file?.path || "",
        type: item?.type || "unknown",
        item_id: item?.id || 0,
        file_id: file?.id || 0,
        width: item?.width || 0,
        height: item?.height || 0,
        // The row's "open details" button makes this object the app-level
        // current item, which is what the gallery's player renders — keep it
        // the same shape the other two builders produce (SelectButton,
        // GalleryPinBoard's selectAsCurrentItem) so outro skip survives —
        // `duration` included, or the cut point loses its end anchor here
        duration: item?.duration,
        content_end_ms: item?.content_end_ms,
    }
    function switchTarget() {
        if (!selected) return
        setFilter({
            target: selected?.sha256,
        }, { history: "push" })
        setPage(1, { history: "push" })
    }
    return (
        <FilterContainer
            label={<span>Similarity Search Target</span>}
            description={<span>The file you're comparing against</span>}
            storageKey="similarity-target-details-open"
        >
            {currentTargetExists && <>
                {resultItem && <SearchResultImage className="mt-4 grid grid-cols-1" result={resultItem} index={0} dbs={dbs} tier={cardTier} />}
                <div className="space-x-2 mt-4">
                    <p className="text-xs text-gray-500 mt-2">
                        {/* Real download, not open-in-tab (same-origin
                            `download` attribute names the file). */}
                        <a href={getFileURL(dbs, "file", "sha256", filter.target)} download={downloadFileName(file?.path, filter.target)}>Download Original File ({sizeString})</a>
                    </p>
                    {item && <p className="text-xs text-gray-500 mt-2">
                        Type: {item.type} {resolutionString && `(${resolutionString})`} {durationString && `(${durationString})`}
                    </p>}
                    {timeAddedString && <p className="text-xs text-gray-500 mt-2">
                        Added: {timeAddedString}
                    </p>}
                </div>
            </>}
            <div className="space-x-2 mt-4">
                <Button variant="outline" title="Set current selection as target" disabled={!selected} onClick={() => switchTarget()}>
                    {currentTargetExists ? "Switch Target" : "Set Selected as Target"}
                </Button>
            </div>
        </FilterContainer>
    )
}
