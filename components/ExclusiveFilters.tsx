"use client"

import { ChevronDown } from "lucide-react"
import { MimeTypeFilter } from "./MimeTypeFilter"
import { PathPrefixFilter } from "./PathFilter"
import { Label } from "./ui/label"
import { Button } from "./ui/button"
import { useState } from "react"
import { FilterContainer } from "./FilterContainer"

export function ExclusiveFilters() {
    return (
        <FilterContainer
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