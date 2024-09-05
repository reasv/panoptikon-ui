import { MimeTypeFilter } from "./MimeTypeFilter"
import { PathPrefixFilter } from "./PathFilter"
import { FilterContainer } from "../base/FilterContainer"

export function ExclusiveFilters() {
    return (
        <FilterContainer
            storageKey="exclusiveFilters" // Add a storageKey prop to make the localStorage key unique
            label={<span>Exclusive Filters</span>}
            description={
                <span>They exclude items that do <b>not</b> match <b>all</b> of them</span>
            }
        >
            <PathPrefixFilter />
            <MimeTypeFilter />
        </FilterContainer>
    );
}