"use client"
import { useEffect } from 'react'
import { useSearchQuery } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"
import { MSquare } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

export function Fts5ToggleButton({
    onFTS5Enable
}: {
    onFTS5Enable: (enabled: boolean) => void
}) {
    const rawFts5Match = useSearchQuery((state) => state.any_text.raw_fts5_match)
    const setRawFts5Match = useSearchQuery((state) => state.setRawFts5Match)

    const { toast } = useToast()
    const onClickFTS5Toggle = () => {
        const newValue = !rawFts5Match
        onFTS5Enable(newValue)
        setRawFts5Match(newValue)
        let description = "You can now use natural language queries"
        if (newValue) {
            description = "Consult the SQLite FTS5 documentation for the correct syntax"
        }
        let action = undefined
        if (newValue) {
            action = <ToastAction onClick={() => window.open("https://www.sqlite.org/fts5.html#full_text_query_syntax", "_blank")} altText="FTS5 Docs">Docs</ToastAction>
        }
        toast({
            title: `${newValue ? "Enabled" : "Disabled"} FTS5 MATCH syntax`,
            description,
            action,
            duration: 3000
        })
    }
    return (
        <Toggle
            onClick={() => onClickFTS5Toggle()}
            pressed={rawFts5Match}
            title={`FTS5 MATCH syntax in query is ${rawFts5Match ? "enabled" : "disabled"}`}
            aria-label="Toggle FTS5 syntax">
            <MSquare className="h-4 w-4" />
        </Toggle>
    )
}