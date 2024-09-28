import { SwitchDB } from "./options/switchDB"
import { SwitchBookmarkNs } from "./options/bookmarks"
import { BookmarksFilter } from "./options/bookmarkFilter"
import { AnyTextFilter } from "./options/anyTextFilter"
import { OrderBy } from "./options/orderBy"
import { PageSizeSlider } from "./options/pageSize"
import { ExclusiveFilters } from "./options/ExclusiveFilters"
import { TagFilter } from "./options/tagFilter"
import { ModelOptions } from "./options/ModelOptions"
import { ItemSimilarityWrapper } from "./options/itemSimilarity/itemSimilarity"

export function SearchOptions() {
    return (
        <div className="mt-4">
            <SwitchDB />
            <SwitchBookmarkNs />
            <BookmarksFilter />
            <OrderBy />
            <PageSizeSlider />
            <AnyTextFilter />
            <ExclusiveFilters />
            <TagFilter />
            <ItemSimilarityWrapper />
            <ModelOptions />
        </div>
    )
}