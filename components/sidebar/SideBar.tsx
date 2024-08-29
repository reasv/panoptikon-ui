"use client"
import { SidebarClose } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAdvancedOptions } from "@/lib/zust"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent } from "../ui/drawer"
import { ScrollArea } from "../ui/scroll-area"
import { SearchOptions } from "./AdvancedSearchOptions"

function SideBarContent() {
    const setOpen = useAdvancedOptions((state) => state.setOpened)
    return (
        <>
            <Button title="Close Advanced Options" onClick={() => setOpen(false)} variant="ghost" size="icon">
                <SidebarClose className="h-4 w-4" />
            </Button>
            <SearchOptions />
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