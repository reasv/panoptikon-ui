import { MimeTypeFilter } from "./MimeTypeFilter"
import { PathPrefixFilter } from "./PathPrefixFilter"
import { FilterContainer } from "../base/FilterContainer"
import { PathTextFilter } from "./PathTextFilter";
import { ExtractedTextFilter } from "./ExtractedTextFilter";
import { ImgEmbSearch, TextEmbSearch } from "./EmbeddingFilters";

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
            <PathPrefixFilter negative />
            <MimeTypeFilter />
            <PathTextFilter />
            <ExtractedTextFilter />
            <ImgEmbSearch />
            <TextEmbSearch />
        </FilterContainer>
    );
}