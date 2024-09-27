"use client"
import { $api } from "@/lib/api"
import { FilterContainer } from "../base/FilterContainer";
import { keepPreviousData } from "@tanstack/react-query";
import { getFullFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { SearchResultImage } from "@/components/SearchResultImage";
import { Button } from "@/components/ui/button";
import { useItemSelection } from "@/lib/state/itemSelection";
import { useItemSimilarityOptions } from "@/lib/state/similarityQuery/clientHooks";

export function SimilarityTargetItem() {
    const selected = useItemSelection((state) => state.getSelected())
    const [dbs, ___] = useSelectedDBs()
    const [options, setOptions] = useItemSimilarityOptions()
    const { data } = $api.useQuery("get", "/api/items/item/{sha256}", {
        params: {
            path: {
                sha256: options.item!,
            },
            query: dbs
        }
    },
        {
            placeholderData: keepPreviousData
        })
    const sizeString = data ? prettyPrintBytes(data.item.size || 0) : 0
    const resolutionString = data && data.item.width && data.item.height ? `${data.item.width}x${data.item.height}` : null
    const timeAddedString = data ? getLocale(new Date(data.item.time_added)) : null
    const durationString = data && data.item.duration ? prettyPrintVideoDuration(data.item.duration) : null
    const item = data?.item
    const file = data?.files[0]
    const resultItem = {
        sha256: options.item!,
        last_modified: file?.last_modified || "1970-09-02T14:30:00Z",
        path: file?.path || "",
        type: item?.type || "unknown",
    }
    function switchTarget() {
        if (!selected) return
        setOptions({
            item: selected?.sha256,
            page: 1,
        })
    }
    return (
        <FilterContainer
            label={<span>Similarity Search Target</span>}
            description={<span>The file you're comparing against</span>}
            storageKey="similarity-item-details-open"
        >
            {resultItem && <SearchResultImage className="mt-4 grid grid-cols-1" result={resultItem} index={0} dbs={dbs} />}
            <div className="space-x-2 mt-4">
                <p className="text-xs text-gray-500 mt-2">
                    <a href={getFullFileURL(options.item!, dbs)} target="_blank">Download Original File ({sizeString})</a>
                </p>
                {item && <p className="text-xs text-gray-500 mt-2">
                    Type: {item.type} {resolutionString && `(${resolutionString})`} {durationString && `(${durationString})`}
                </p>}
                {timeAddedString && <p className="text-xs text-gray-500 mt-2">
                    Added: {timeAddedString}
                </p>}
            </div>
            <div className="space-x-2 mt-4">
                <Button variant="outline" title="Set current selection as target" disabled={!selected} onClick={() => switchTarget()}>
                    Switch Target
                </Button>
            </div>
        </FilterContainer>
    )
}
