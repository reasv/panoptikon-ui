"use client"
import { $api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { SidebarClose } from "lucide-react"

import { Button } from "@/components/ui/button"

import { SwitchDB } from "./switchDB"
import { SwitchBookmarkNs } from "./bookmarks"
import { BookmarksFilter } from "./bookmarkFilter"
import { AnyTextFilter } from "./anyTextFilter"
import { OrderBy } from "./orderBy"
import { PageSizeSlider } from "./pageSize"
import { useAdvancedOptions } from "@/lib/zust"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent } from "./ui/drawer"
import { ScrollArea } from "./ui/scroll-area"
import { ExclusiveFilters } from "./ExclusiveFilters"

export function SearchOptions() {
    const setOpened = useAdvancedOptions((state) => state.setOpened)
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

