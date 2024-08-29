"use client"
import { BookOpen } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from './ui/button'
import { useAdvancedOptions, useDetailsPane, useItemSelection } from "@/lib/zust"
import { components } from "@/lib/panoptikon"
import { Toggle } from "./ui/toggle"

function itemEquals(a: components["schemas"]["FileSearchResult"], b: components["schemas"]["FileSearchResult"]) {
    return a.sha256 === b.sha256 && a.path === b.path
}
export function OpenDetailsButton({
    item
}: {
    item?: components["schemas"]["FileSearchResult"]
}) {
    const { toast } = useToast()
    const setAdvancedOptions = useAdvancedOptions((state) => state.setOpened)
    const setDetailsPane = useDetailsPane((state) => state.setSidebarTab)
    const setSelected = useItemSelection((state) => state.setItem)
    const advancedOptionsOpen = useAdvancedOptions((state) => state.isOpen)
    const sidebarTab = useDetailsPane((state) => state.sidebarTab)
    const detailsPaneOpen = (sidebarTab === 1) && advancedOptionsOpen
    const selectedItem = useItemSelection((state) => state.getSelected())

    const itemDetailsOpen = item && (selectedItem === item) && detailsPaneOpen

    const openDetailsPane = () => {
        if (item) {
            if (selectedItem !== item) {
                setSelected(item)
            }
        }
        setAdvancedOptions(true)
        setDetailsPane(1)
        toast({
            title: "Opening File Details",
            description: "You can find all data associated with the item here",
            duration: 3000
        })
    }
    const closeDetailsPane = () => {
        setAdvancedOptions(false)
    }
    const onClick = () => {
        if (itemDetailsOpen) {
            closeDetailsPane()
        } else {
            openDetailsPane()
        }
    }
    return (
        <Toggle
            pressed={itemDetailsOpen}
            onClick={() => onClick()}
            title={itemDetailsOpen ? "Open Data View" : "Close Data View"}
            aria-label={itemDetailsOpen ? "Open Data View" : "Close Data View"}
        >
            <BookOpen className="h-4 w-4" />
        </Toggle>
    )
}