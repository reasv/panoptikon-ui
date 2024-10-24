"use client"
import { BookOpen, Book } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from './ui/button'
import { components } from "@/lib/panoptikon"
import { Toggle } from "./ui/toggle"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSideBarOpen, useSideBarTab } from "@/lib/state/sideBar"

export function itemEquals(a: SearchResult, b: SearchResult) {
    return a.file_id === b.file_id
}
export function OpenDetailsButton({
    item,
    variantButton
}: {
    item?: SearchResult,
    variantButton?: boolean
}) {
    const { toast } = useToast()
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    const [tab, setTab] = useSideBarTab()
    const setSelected = useItemSelection((state) => state.setItem)
    const detailsPaneOpen = (tab === 1) && sidebarOpen
    const selectedItem = useItemSelection((state) => state.getSelected())

    const itemDetailsOpen = !!item && !!selectedItem && itemEquals(selectedItem, item) && detailsPaneOpen

    const openDetailsPane = () => {
        if (item) {
            if (selectedItem !== item) {
                setSelected(item)
            }
        }
        setSideBarOpen(true)
        setTab(1)
        toast({
            title: "Opening File Details",
            description: "You can find all data associated with the item here",
            duration: 3000
        })
    }
    const closeDetailsPane = () => {
        setSideBarOpen(false)
    }
    const onClick = () => {
        if (itemDetailsOpen) {
            closeDetailsPane()
        } else {
            openDetailsPane()
        }
    }
    return (
        variantButton ? (
            <Button
                onClick={() => onClick()}
                title={!itemDetailsOpen ? "Open in Data View" : "Close Data View"}
                aria-label={!itemDetailsOpen ? "Open in Data View" : "Close Data View"}
                className="hover:scale-105 absolute bottom-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                size="icon"
            >
                {itemDetailsOpen ? <Book className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
            </Button>
        ) : (
            <Toggle
                pressed={itemDetailsOpen}
                onClick={() => onClick()}
                title={!itemDetailsOpen ? "Open Data View" : "Close Data View"}
                aria-label={!itemDetailsOpen ? "Open Data View" : "Close Data View"}
            >
                <BookOpen className="h-4 w-4" />
            </Toggle>
        )

    )
}