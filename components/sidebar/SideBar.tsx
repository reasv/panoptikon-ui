import { SidebarClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent, DrawerTitle } from "../ui/drawer"
import { ScrollArea } from "../ui/scroll-area"
import { SearchOptions } from "./AdvancedSearchOptions"
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs"
import { ItemDetails } from "./details/ItemDetails"
import { SimilarItemsSideBar } from "./similarity/SimilarItemsSideBar"
import { useSideBarOpen, useSideBarTab } from "@/lib/state/sideBar"

// The sidebar's inner content (the tabs block), shared between the page
// containers below and the maximized board's left-edge sidebar overlay
// (app/search/SidebarOverlay.tsx, docs/maximized-pinboard-search-overlay-
// design.md §9). Both mounts drive the same URL/tab state (`sbt`), and only
// one is ever mounted at a time: the page <SideBar/> is gated
// `!pinboardMaximized` in SearchPageContent, and the overlay mounts only
// while maximized.
//
// `closeButton` is page-only chrome: it drives `sb`, which the overlay must
// never touch — maximize deliberately leaves `sb` alone so the page sidebar
// returns on restore (§9); the overlay has its own pin toggle instead. The
// default keeps the page paths rendering exactly as before the extraction.
export function SideBarContent({ closeButton = true }: { closeButton?: boolean }) {
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
            {closeButton && <Button title="Close Advanced Options" onClick={() => setSideBarOpen(false)} variant="ghost" size="icon">
                <SidebarClose className="h-4 w-4" />
            </Button>}
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
    // Opening and closing must each be ONE atomic layout change — panel,
    // content, and results column all moving in the same commit. Anything
    // staged (an entrance animation, a deferred content mount, a settle
    // latch) splits the toggle into visible steps: the panel appears empty
    // and then "grows" as content fills it, or the content vanishes before
    // the panel does. So the content mounts and unmounts synchronously with
    // the panel — the open pays the content mount inside the toggle's own
    // commit (a single beat, never a two-step), and closing fully unmounts
    // it: whatever the active tab was doing (Similar Items runs the most
    // expensive query in the app) must stop the moment the sidebar closes.
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
            <DrawerTitle title="Options" />
            <DrawerContent>
                <ScrollArea className="h-svh w-full">
                    <SideBarContent />
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    )
}
