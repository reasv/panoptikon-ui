import { SidebarClose } from "lucide-react"
import { startTransition, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Drawer, DrawerContent, DrawerTitle } from "../ui/drawer"
import { ScrollArea } from "../ui/scroll-area"
import { SearchOptions } from "./AdvancedSearchOptions"
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs"
import { ItemDetails } from "./details/ItemDetails"
import { SimilarItemsSideBar } from "./similarity/SimilarItemsSideBar"
import { useSideBarOpen, useSideBarTab } from "@/lib/state/sideBar"
import { cn } from "@/lib/utils"

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

/**
 * Mount latch for the panel's content. Mounting it is the expensive part of
 * opening the sidebar (SearchOptions and friends instantiate a lot of
 * URL-state hooks, ~100-200ms of render + one atomic commit) — done in the
 * toggle's own click task it froze the first half of the opening
 * animation, and even started in a transition its commit still lands as
 * one long frame mid-slide. So the content waits for the shell's entrance
 * animation to finish (onAnimationEnd), with a timer as the fallback for
 * environments where the animation never runs (reduced motion, the mobile
 * drawer whose motion belongs to vaul). The commit's long frame then falls
 * where nothing is moving. startTransition keeps the render itself
 * time-sliced so hover and scroll stay live while it builds.
 */
function useDeferredMount(fallbackMs: number, onFallback: () => void) {
    const [ready, setReady] = useState(false)
    const mount = () => startTransition(() => setReady(true))
    useEffect(() => {
        const timer = setTimeout(() => {
            // The fallback stands in for the animationend that never came,
            // so it must also release whatever waits on the entrance
            onFallback()
            startTransition(() => setReady(true))
        }, fallbackMs)
        return () => clearTimeout(timer)
    }, [fallbackMs, onFallback])
    return [ready, mount] as const
}

export function SideBar({
    settled,
    onSettled,
}: {
    /**
     * Whether the entrance is over (owned by SearchPageContent, which uses
     * it to hold the results column at full width until the slide lands).
     * True from the start for a sidebar already open at mount.
     */
    settled: boolean
    onSettled: () => void
}) {
    const isMobile = useMediaQuery("(max-width: 1024px)")
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    // 350ms fallback: the desktop slide-in runs 200ms and the drawer's own
    // motion is comparable; the timer only matters when no animationend
    // arrives first (reduced motion, the mobile drawer).
    const [contentReady, mountContent] = useDeferredMount(350, () => {
        onSettled()
    })
    const handleSettle = () => {
        onSettled()
        mountContent()
    }
    if (!sidebarOpen) {
        return null
    }
    if (!isMobile) {
        return (
            // While ENTERING the panel is an overlay: absolutely positioned
            // over the results row and animated with transform+opacity only,
            // so from the click to the landing there is zero layout work and
            // the slide runs on the compositor — it cannot stutter no matter
            // what the main thread does. On landing (animationend) it joins
            // the flex flow, the results column narrows (one reflow, see
            // SearchPageContent), and the content mounts — all the expensive
            // work happens while nothing is moving. The final layout is
            // identical to what it always was; the overlay exists only for
            // the 200ms of motion. A deep-linked open (settled from mount)
            // skips the animation entirely, exactly like it used to.
            <div
                className={cn(
                    "h-full lg:w-1/2 xl:w-1/3 2xl:w-1/4 4xl:w-[20%] 5xl:w-[18%] p-4 shadow-lg z-50 hidden lg:block",
                    !settled && "absolute left-0 top-0 bg-background animate-in fade-in slide-in-from-left-8 duration-200"
                )}
                onAnimationEnd={handleSettle}
            >
                <ScrollArea className="h-full">
                    {contentReady && <SideBarContent />}
                </ScrollArea>
            </div>
        )
    }
    return (
        <Drawer open={sidebarOpen} onOpenChange={setSideBarOpen}>
            <DrawerTitle title="Options" />
            <DrawerContent>
                <ScrollArea className="h-svh w-full">
                    {/* Same deferral as desktop (via the fallback timer —
                        the drawer's motion belongs to vaul): the slide-up
                        is just as frozen by a synchronous content mount */}
                    {contentReady && <SideBarContent />}
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    )
}