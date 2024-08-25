"use client"
import { useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Lock } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

export function InstantSearchLock() {
    const setUserEnabled = useSearchQuery((state) => state.setUserSearchEnabled)
    const enabled = useSearchQuery((state) => state.user_enable_search)

    const { toast } = useToast()
    const onClickToggle = () => {
        const newValue = !enabled
        setUserEnabled(newValue)
        let description = "New results will be fetched automatically"
        if (!newValue) {
            description = "Refresh manually to get new search results"
        }
        toast({
            title: `Auto Update Lock ${newValue ? "OFF" : "ON"}`,
            description,
            duration: 2000
        })
    }
    return (
        <Toggle onClick={onClickToggle} title={enabled ? "Update Lock is OFF. Results are updated automatically" : "Update Lock is ON. Click on the refresh button to update results"} aria-label="Toggle bold">
            <Lock className="h-4 w-4" />
        </Toggle>
    )
}