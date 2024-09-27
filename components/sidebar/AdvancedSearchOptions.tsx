import { SwitchDB } from "./options/switchDB"
import { SwitchBookmarkNs } from "./options/bookmarks"
import { BookmarksFilter } from "./options/bookmarkFilter"
import { AnyTextFilter } from "./options/anyTextFilter"
import { OrderBy } from "./options/orderBy"
import { PageSizeSlider, SimilarityPageSizeSlider } from "./options/pageSize"
import { ExclusiveFilters } from "./options/ExclusiveFilters"
import { ResetSimilarityFilters, SimilarityModeOptionsClip, SimilarityModeOptionsText, SimilarityModeSwitch } from "./similarity/SimilarityModeOptions"
import { SimilarityTargetItem } from "./options/similarityTarget"
import { TagFilter } from "./options/tagFilter"
import { Mode, useSearchMode } from "@/lib/state/searchMode"
import { useItemSimilarityOptions } from "@/lib/state/similarityQuery/clientHooks"
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"
import { ModelOptions } from "./options/ModelOptions"
import { ImgEmbSearch, TextEmbSearch } from "./options/EmbeddingFilters"

export function SearchOptions() {
    const [mode, setMode] = useSearchMode()
    const [similarityQuery, setSimilarityQuery] = useItemSimilarityOptions()
    return (
        <div className="mt-4">
            <SwitchDB />
            <SwitchBookmarkNs />
            {mode === Mode.ItemSimilarity && <>
                <SimilarityPageSizeSlider />
                <SimilarityTargetItem />
                <SimilarityModeSwitch />
                {similarityQuery.type === SimilarityQueryType.clip && <SimilarityModeOptionsClip />}
                {similarityQuery.type === SimilarityQueryType.textEmbedding && <SimilarityModeOptionsText />}
                <ResetSimilarityFilters />
            </>}
            {mode === Mode.Search && <>
                <BookmarksFilter />
                <OrderBy />
                <PageSizeSlider />
                <AnyTextFilter />
                <ExclusiveFilters />
                <TagFilter />
                <ImgEmbSearch />
                <TextEmbSearch />
                <ModelOptions />
            </>
            }
        </div>
    )
}

