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

export function SearchOptions() {
    const isDesktop = useMediaQuery("(min-width: 768px)")
    const isOpen = useAdvancedOptions((state) => state.isOpen)
    const toggleOpen = useAdvancedOptions((state) => state.toggle)
    const setOpened = useAdvancedOptions((state) => state.setOpened)
    return (
        <div className="fixed top-0 left-0 w-1/4 h-full p-4 shadow-lg z-50">
            <Card>
                <CardHeader>
                    <CardTitle>
                        <div className="flex gap-2">
                            <h2 className="text-lg font-semibold w-full mt-3">Advanced Search Options</h2>
                            <Button title="Close Advanced Options" onClick={() => setOpened(false)} variant="ghost" size="icon">
                                <SidebarClose className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <SwitchDB />
                    <SwitchBookmarkNs />
                    <BookmarksFilter />
                    <OrderBy />
                    <PageSizeSlider />
                    <AnyTextFilter />
                </CardContent>
            </Card>
        </div>
    )
}

export function AdvancedSearchOptions() {
    const isOpen = useAdvancedOptions((state) => state.isOpen)
    return isOpen ? <SearchOptions /> : null
}