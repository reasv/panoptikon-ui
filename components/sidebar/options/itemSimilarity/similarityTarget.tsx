import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query";
import { downloadFileName, getFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { SearchResultImage } from "@/components/SearchResultImage";
import { ResultCellSkeleton } from "@/components/ResultCellSkeleton";
import { Button } from "@/components/ui/button";
import { useItemSelection } from "@/lib/state/itemSelection";
import { useItemSimilaritySearch, useSearchPage } from "@/lib/state/searchQuery/clientHooks";
import { FilterContainer } from "../../base/FilterContainer";
import { tierForCellWidth } from "@/lib/thumbnailTier";
import { useDevicePixelRatio } from "@/hooks/useDevicePixelRatio";
import { useAnimatedFloor, useDisplayLoopTrigger } from "@/lib/useClientConfig";

// The nominal CSS width of this ONE card, which spans the sidebar's whole
// content width (grid-cols-1): ~350px at a 1280px window, ~700px at 4K. The
// same nominal-rather-than-measured call as SimilarItemsView's, for the same
// reason — a single card behind a collapsible panel.
const TARGET_CARD_CSS_WIDTH = 700

export function SimilarityTarget() {
    const selected = useItemSelection((state) => state.getSelected())
    const [dbs, ___] = useSelectedDBs()
    const cardTier = tierForCellWidth(TARGET_CARD_CSS_WIDTH, useDevicePixelRatio())
    // A grid-tier request, so it needs the floor for the same reason the
    // result grid does — see SearchResultImage's `animatedFloor` prop.
    const animatedFloor = useAnimatedFloor()
    // Read here rather than in the card, exactly like the floor: one subject,
    // one read, and SearchResultImage keeps its no-subscription contract.
    const displayLoopTrigger = useDisplayLoopTrigger()
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
    // THE PICTURE WAITS FOR ITS OWN ITEM. `data` is not this target's metadata
    // until the query has answered for THIS sha, and there are two states where
    // it is not:
    //
    //   - the first render after a cold mount, where `data` is undefined;
    //   - the whole round trip after a target switch, where `keepPreviousData`
    //     hands back the PREVIOUS item's metadata while `filter.target` is
    //     already the new sha.
    //
    // Either way a row built from it describes one file's bytes with another
    // file's type and dimensions, and the animated decision reads exactly those
    // fields. A missing `type` is worse still: `"unknown"` is not a mime this
    // card can reason about, and `isAnimatedItem` answers "not animated" for it
    // — which is PERMISSIVE, not conservative. The card would then request the
    // bare grid tier for a target that turns out to be an animated GIF above
    // the raw floor, and the endpoint answers `video/mp4` into an `<img>`: a
    // blank cell for the length of the round trip (reproduced at 1.5s latency).
    //
    // So: no row at all until the answer is this target's answer. The cost is
    // one skeleton for one RTT, which is what the rest of the grid already
    // shows for a row it does not have yet.
    //
    // The metadata LINES below deliberately keep the previous-data behaviour —
    // stale text for a moment is what `keepPreviousData` is here for, and text
    // cannot be mistaken for a broken picture.
    const resolvedItem = item && item.sha256 === filter.target ? item : null
    const resultItem = resolvedItem && {
        sha256: filter.target,
        last_modified: file?.last_modified || "1970-09-02T14:30:00Z",
        path: file?.path || "",
        type: resolvedItem.type,
        item_id: resolvedItem.id,
        file_id: file?.id || 0,
        width: resolvedItem.width,
        height: resolvedItem.height,
        // The row's "open details" button makes this object the app-level
        // current item, which is what the gallery's player renders — keep it
        // the same shape the other two builders produce (SelectButton,
        // GalleryPinBoard's selectAsCurrentItem) so outro skip survives —
        // `duration` included, or the cut point loses its end anchor here
        duration: resolvedItem.duration,
        content_end_ms: resolvedItem.content_end_ms,
        // The fourth field the animated decision reads (lib/thumbnailTier.ts),
        // and the one whose absence really would have been safe: no size
        // answers `"still"`, which is a poster where the card could have shown
        // the loop. `type` is the field that had no safe absence, which is why
        // the whole row now waits rather than defaulting any of them.
        size: resolvedItem.size,
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
                {resultItem
                    ? <SearchResultImage className="mt-4 grid grid-cols-1" result={resultItem} index={0} dbs={dbs} tier={cardTier} animatedFloor={animatedFloor} displayLoopTrigger={displayLoopTrigger} />
                    : <ResultCellSkeleton className="mt-4 grid grid-cols-1" />}
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
