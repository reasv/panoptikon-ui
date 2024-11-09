"use client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SwitchDB } from "@/components/sidebar/options/switchDB"
import { CreateNewDB } from "@/components/scan/CreateDB"
import { Config } from "@/components/scan/Config"
import { GroupList } from "@/components/scan/GroupLists"
import { JobQueue } from "@/components/scan/JobQueue"
import { JobHistory } from "@/components/scan/JobHistory"
import { FolderLists } from "@/components/scan/FolderLists"
import { Button } from "@/components/ui/button"
import { SidebarClose } from "lucide-react"
import { useScanDrawerOpen } from "@/lib/state/scanDrawer"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"

export function ScanInternal() {
    return <>
        <div className='grid gap-4 grid-cols-1 lg:grid-cols-2'>
            <SwitchDB />
            <CreateNewDB />
        </div>
        <Config />
        <FolderLists />
        <GroupList />
        <JobQueue />
        <JobHistory />
    </>
}

export function ScanDrawer() {
    const [open, setOpen] = useScanDrawerOpen()
    if (!open) {
        return null
    }
    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTitle title="Scan" />
            <DrawerContent>
                <ScrollArea className="h-svh w-full">
                    <Button onClick={() => setOpen(false)} title="Back to Search" variant="ghost" size="icon">
                        <SidebarClose className="h-4 w-4" />
                    </Button>
                    <ScanInternal />
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    )
}