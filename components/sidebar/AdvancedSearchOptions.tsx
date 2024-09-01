"use client"

import { SwitchDB } from "./options/switchDB"
import { SwitchBookmarkNs } from "./options/bookmarks"
import { BookmarksFilter } from "./options/bookmarkFilter"
import { AnyTextFilter } from "./options/anyTextFilter"
import { OrderBy } from "./options/orderBy"
import { PageSizeSlider, SimilarityPageSizeSlider } from "./options/pageSize"
import { ExclusiveFilters } from "./options/ExclusiveFilters"
import { Mode, useSearchMode } from "@/lib/state/similarityQuery"

export function SearchOptions() {
    const [mode, setMode] = useSearchMode()
    return (
        <div className="mt-4">
            <SwitchDB />
            <SwitchBookmarkNs />
            {mode === Mode.ItemSimilarity && <SimilarityPageSizeSlider />}
            {mode === Mode.Search && <>
                <BookmarksFilter />
                <OrderBy />
                <PageSizeSlider />
                <AnyTextFilter />
                <ExclusiveFilters />
            </>
            }
        </div>
    )
}

