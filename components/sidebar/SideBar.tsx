"use client"
import { SidebarClose } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAdvancedOptions, useDetailsPane } from "@/lib/zust"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent } from "../ui/drawer"
import { ScrollArea } from "../ui/scroll-area"
import { SearchOptions } from "./AdvancedSearchOptions"
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs"
import { ItemDetails } from "./details/ItemDetails"

function SideBarContent() {
    const setOpen = useAdvancedOptions((state) => state.setOpened)
    const currentTab = useDetailsPane((state) => state.sidebarTab)
    const setCurrentTab = useDetailsPane((state) => state.setSidebarTab)
    const tabs = [
        {
            id: 0,
            label: "Search Options",
            content: (
                <SearchOptions />
            ),
        },
        {
            id: 1,
            label: "File Details",
            content: (
                <ItemDetails />
            ),
        },
        {
            id: 2,
            label: "Similar Items",
            content: (
                <SearchOptions />
            ),
        },
    ]
    return (
        <>
            <Button title="Close Advanced Options" onClick={() => setOpen(false)} variant="ghost" size="icon">
                <SidebarClose className="h-4 w-4" />
            </Button>
            <DirectionAwareTabs
                tabs={tabs}
                currentTab={currentTab}
                onChange={setCurrentTab}
            />
        </>
    )
}

export function SideBar() {
    const isDesktop = useMediaQuery("(min-width: 1024px)")
    const isOpen = useAdvancedOptions((state) => state.isOpen)
    const setOpen = useAdvancedOptions((state) => state.setOpened)
    if (!isOpen) {
        return null
    }
    if (isDesktop) {
        return (
            <div className="h-full md:w-1/2 lg:w-1/2 xl:w-1/3 2xl:w-1/4 p-4 shadow-lg z-50 hidden lg:block">
                <ScrollArea className="h-full">
                    <SideBarContent />
                </ScrollArea>
            </div>
        )
    }
    return (
        <Drawer open={isOpen} onOpenChange={setOpen}>
            <DrawerContent>
                <ScrollArea className="h-svh w-full">
                    <SideBarContent />
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    )
}