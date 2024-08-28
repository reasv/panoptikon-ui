"use client"

import { ChevronDown } from "lucide-react"
import { MimeTypeFilter } from "./MimeTypeFilter"
import { PathPrefixFilter } from "./PathFilter"
import { Label } from "./ui/label"
import { Button } from "./ui/button"
import { useState } from "react"
export function ExclusiveFilters() {
    const [isExpanded, setIsExpanded] = useState(true);

    const toggleFilters = () => {
        setIsExpanded((prev) => !prev);
    };

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Exclusive Filters
                    </Label>
                    <div className="text-gray-400">
                        They exclude items that do <b>not</b> match <b>all</b> of them
                    </div>
                </div>
                <Button title="Hide these filters" variant="ghost" size="icon" onClick={toggleFilters}>
                    <ChevronDown
                        className={`h-4 w-4 transform transition-transform duration-300 ${isExpanded ? "rotate-0" : "rotate-90"
                            }`}
                    />
                </Button>
            </div>
            <div
                className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${isExpanded ? "max-h-screen" : "max-h-0"
                    }`}
            >
                <PathPrefixFilter />
                <MimeTypeFilter />
            </div>
        </div>
    );
}