import { SwitchDB } from "./options/switchDB"
import { SwitchBookmarkNs } from "./options/bookmarks"
import { BookmarksFilter } from "./options/bookmarkFilter"
import { AnyTextFilter } from "./options/anyTextFilter"
import { OrderBy } from "./options/orderBy"
import { PageSizeSlider, SimilarityPageSizeSlider } from "./options/pageSize"
import { ExclusiveFilters } from "./options/ExclusiveFilters"
import { Mode, SimilarityQueryType, useSearchMode, useSimilarityQuery } from "@/lib/state/similarityQuery"
import { SimilarityModeOptionsClip, SimilarityModeOptionsText, SimilarityModeSwitch } from "./similarity/SimilarityModeOptions"
import { SimilarityTargetItem } from "./options/similarityTarget"
import { TagFilter } from "./options/tagFilter"

export function SearchOptions() {
    const [mode, setMode] = useSearchMode()
    const [similarityQuery, setSimilarityQuery] = useSimilarityQuery()
    return (
        <div className="mt-4">
            <SwitchDB />
            <SwitchBookmarkNs />
            {mode === Mode.ItemSimilarity && <>
                <SimilarityPageSizeSlider />
                <SimilarityTargetItem />
                <SimilarityModeSwitch />
                {similarityQuery.is_type === SimilarityQueryType.clip && <SimilarityModeOptionsClip />}
                {similarityQuery.is_type === SimilarityQueryType.textEmbedding && <SimilarityModeOptionsText />}
            </>}
            {mode === Mode.Search && <>
                <BookmarksFilter />
                <OrderBy />
                <PageSizeSlider />
                <AnyTextFilter />
                <ExclusiveFilters />
                <TagFilter />
            </>
            }
        </div>
    )
}

