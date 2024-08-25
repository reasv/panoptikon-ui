"use client"
import { useEffect } from "react"
import { useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"
import { Lock } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

export function InstantSearchLock() {
    const setUserEnabled = useSearchQuery((state) => state.setUserSearchEnabled)
    const enabled = useSearchQuery((state) => state.user_enable_search)

    const { toast } = useToast()

    useEffect(() => {
        const storedValue = localStorage.getItem("auto-update-enabled")
        if (storedValue !== null) {
            setUserEnabled(JSON.parse(storedValue))
        }
    }, [setUserEnabled])

    const onClickToggle = () => {
        const newValue = !enabled
        setUserEnabled(newValue)
        localStorage.setItem("auto-update-enabled", JSON.stringify(newValue))

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
        <Toggle
            pressed={!enabled}
            onClick={onClickToggle}
            title={enabled ? "Update Lock is OFF. Results are updated automatically" : "Update Lock is ON. Click on the refresh button to update results"}
            aria-label="Toggle auto-update lock"
        >
            <Lock className="h-4 w-4" />
        </Toggle>
    )
}
