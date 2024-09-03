"use client"
import { SidebarClose } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent } from "../ui/drawer"
import { ScrollArea } from "../ui/scroll-area"
import { SearchOptions } from "./AdvancedSearchOptions"
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs"
import { ItemDetails } from "./details/ItemDetails"
import { SimilarItemsSideBar } from "./similarity/SimilarItemsSideBar"
import { useSideBarOpen, useSideBarTab } from "@/lib/state/sideBar"

function SideBarContent() {
    const [_, setSideBarOpen] = useSideBarOpen()
    const [tab, setTab] = useSideBarTab()
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
                <SimilarItemsSideBar />
            ),
        },
    ]
    return (
        <>
            <Button title="Close Advanced Options" onClick={() => setSideBarOpen(false)} variant="ghost" size="icon">
                <SidebarClose className="h-4 w-4" />
            </Button>
            <DirectionAwareTabs
                tabs={tabs}
                currentTab={tab}
                onChange={setTab}
            />
        </>
    )
}

export function SideBar() {
    const isMobile = useMediaQuery("(max-width: 1024px)")
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    if (!sidebarOpen) {
        return null
    }
    if (!isMobile) {
        return (
            <div className="h-full lg:w-1/2 xl:w-1/3 2xl:w-1/4 4xl:w-[20%] 5xl:w-[18%] p-4 shadow-lg z-50 hidden lg:block">
                <ScrollArea className="h-full">
                    <SideBarContent />
                </ScrollArea>
            </div>
        )
    }
    return (
        <Drawer open={sidebarOpen} onOpenChange={setSideBarOpen}>
            <DrawerContent>
                <ScrollArea className="h-svh w-full">
                    <SideBarContent />
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    )
}