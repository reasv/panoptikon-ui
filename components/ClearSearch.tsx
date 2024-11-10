import { Delete } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useEmbedArgs, useOrderArgs, useResetSearchQueryState } from "@/lib/state/searchQuery/clientHooks"
import { Toggle } from "./ui/toggle"
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu"
import { useSearchClearSettings } from "@/lib/state/clearSearchOptions"
import { MultiBoxResponsive } from "./multiCombobox"

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
    const allOptions = [
        {
            label: "Clear Page Size",
            value: "page_size",
        },
        {
            label: "Clear Order By Options",
            value: "order_by",
        },
        {
            label: "Search Types",
            value: "search_types",
        },
        {
            label: "Clear Model Cache Settings",
            value: "model_cache",
        },

    ]
    const selectedOptions: string[] = [
        ...(clearSettings.pageSize ? [] : ["page_size"])
    ].concat(
        [...
            clearSettings.orderBy ? [] : ["order_by"]
        ])
        .concat([...
            clearSettings.modelCache ? [] : ["model_cache"]
        ])
        .concat([...
            clearSettings.searchTypes ? [] : ["search_types"]
        ])

    const onSelectionChange = (selectedOptions: string[]) => {
        const newSettings = {
            page_size: selectedOptions.includes("page_size"),
            orderBy: selectedOptions.includes("order_by"),
            modelCache: selectedOptions.includes("model_cache"),
            searchTypes: selectedOptions.includes("search_types")
        }
        clearSettings.setPageSize(newSettings.page_size)
        clearSettings.setOrderBy(newSettings.orderBy)
        clearSettings.setModelCache(newSettings.modelCache)
        clearSettings.setSearchTypes(newSettings.searchTypes)
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
                <MultiBoxResponsive
                    options={allOptions}
                    currentValues={selectedOptions}
                    onSelectionChange={onSelectionChange}
                    placeholder="Select an option"
                    maxDisplayed={1}
                    omitSearchBar={true}
                    omitWrapper={true}
                />
            </ContextMenuContent>
        </ContextMenu>
    )
}