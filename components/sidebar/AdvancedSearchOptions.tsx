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
        <div className="mt-4">
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

