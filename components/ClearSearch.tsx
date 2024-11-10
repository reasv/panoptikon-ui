import { Delete } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from './ui/button'
import { useEmbedArgs, useOrderArgs, useResetSearchQueryState } from "@/lib/state/searchQuery/clientHooks"
import { Toggle } from "./ui/toggle"
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "./ui/context-menu"
import { useSearchClearSettings } from "@/lib/state/clearSearchOptions"

export function ClearSearch() {
    const { toast } = useToast()
    const reset = useResetSearchQueryState()
    const [embedArgs, setEmbedArgs] = useEmbedArgs()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const clearSettings = useSearchClearSettings((state) => state)
    const clearSearchQuery = () => {
        const oldOrderArgs = orderArgs
        reset()
        if (clearSettings.modelCache) {
            setEmbedArgs(null)
        }
        if (!clearSettings.orderBy) {
            setOrderArgs({
                order_by: oldOrderArgs.order_by,
                order: oldOrderArgs.order
            })
        }
        if (!clearSettings.pageSize) {
            setOrderArgs({
                page_size: oldOrderArgs.page_size
            })
        }
        toast({
            title: "Cleared Query",
            description: "All search options have been cleared",
            duration: 3000
        })
    }
    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <Toggle
                    pressed={false}
                    onClick={() => clearSearchQuery()}
                    title={"Clear all query options"}
                    aria-label="Clear all query options"
                >
                    <Delete className="h-4 w-4" />
                </Toggle>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                <ContextMenuCheckboxItem
                    checked={clearSettings.pageSize}
                    onClick={() => clearSettings.setPageSize(!clearSettings.pageSize)}
                >
                    Clear Page Size
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                    checked={clearSettings.orderBy}
                    onClick={() => clearSettings.setOrderBy(!clearSettings.orderBy)}
                >
                    Clear Order By Options
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                    checked={clearSettings.modelCache}
                    onClick={() => clearSettings.setModelCache(!clearSettings.modelCache)}
                >
                    Clear Model Cache Settings
                </ContextMenuCheckboxItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}