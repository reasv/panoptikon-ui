import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query";
import { getFullFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { SearchResultImage } from "@/components/SearchResultImage";
import { Button } from "@/components/ui/button";
import { useItemSelection } from "@/lib/state/itemSelection";
import { useItemSimilaritySearch, useSearchPage } from "@/lib/state/searchQuery/clientHooks";
import { FilterContainer } from "../../base/FilterContainer";

export function SimilarityTarget() {
    const selected = useItemSelection((state) => state.getSelected())
    const [dbs, ___] = useSelectedDBs()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [page, setPage] = useSearchPage()
    const currentTargetExists = filter.target.length > 0
    const { data } = $api.useQuery("get", "/api/items/item/{sha256}", {
        params: {
            path: {
                sha256: filter.target,
            },
            query: dbs
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
                {resultItem && <SearchResultImage className="mt-4 grid grid-cols-1" result={resultItem} index={0} dbs={dbs} />}
                <div className="space-x-2 mt-4">
                    <p className="text-xs text-gray-500 mt-2">
                        <a href={getFullFileURL(filter.target, dbs)} target="_blank">Download Original File ({sizeString})</a>
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
