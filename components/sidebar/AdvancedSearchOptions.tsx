"use client"

import { SwitchDB } from "./options/switchDB"
import { SwitchBookmarkNs } from "./options/bookmarks"
import { BookmarksFilter } from "./options/bookmarkFilter"
import { AnyTextFilter } from "./options/anyTextFilter"
import { OrderBy } from "./options/orderBy"
import { PageSizeSlider } from "./options/pageSize"
import { ExclusiveFilters } from "./options/ExclusiveFilters"

export function SearchOptions() {
    return (
        <div>
            <div className="flex gap-2">
                <h2 className="text-lg font-semibold w-full">Advanced Search Options</h2>
            </div>
            <SwitchDB />
            <SwitchBookmarkNs />
            <BookmarksFilter />
            <OrderBy />
            <PageSizeSlider />
            <AnyTextFilter />
            <ExclusiveFilters />
        </div>
    )
}

