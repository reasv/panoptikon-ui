"use client"

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
                    These filters exclude any item that does NOT match them
                </div>
            </div>
            <PathPrefixFilter />
        </div>
    )
}