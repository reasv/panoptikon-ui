import { Toggle } from "@/components/ui/toggle"
import { MSquare } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

export function Fts5ToggleButton({
    onFTS5Enable,
    isFTS5Enabled
}: {
    onFTS5Enable: (enabled: boolean) => Promise<boolean> // Returns true if fts5 was enabled
    isFTS5Enabled: boolean
}) {
    const { toast } = useToast()
    const onClickFTS5Toggle = async () => {
        const newValue = !isFTS5Enabled
        if (await onFTS5Enable(newValue)) {
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
        } else {
            toast({
                title: "Failed to enable FTS5 MATCH syntax",
                description: "Check your query syntax",
                variant: "destructive",
                duration: 3000
            })
        }
    }
    return (
        <Toggle
            onClick={() => onClickFTS5Toggle()}
            pressed={isFTS5Enabled}
            title={`FTS5 MATCH syntax in query is ${isFTS5Enabled ? "enabled" : "disabled"}`}
            aria-label="Toggle FTS5 syntax">
            <MSquare className="h-4 w-4" />
        </Toggle>
    )
}