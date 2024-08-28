"use client"

import { MimeTypeFilter } from "./MimeTypeFilter"
import { PathPrefixFilter } from "./PathFilter"
import { Label } from "./ui/label"
export function ExclusiveFilters() {

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="space-y-0.5">
                <Label className="text-base">
                    Exclusive Filters
                </Label>
                <div className="text-gray-400">
                    They exclude items that do <b>not</b> match <b>all</b> of them
                </div>
            </div>
            <PathPrefixFilter />
            <MimeTypeFilter />
        </div>
    )
}