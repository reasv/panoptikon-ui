import { Delete } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useATSemanticImage, useATSemanticText, useEmbedArgs, useOrderArgs, useQueryOptions, useResetSearchQueryState } from "@/lib/state/searchQuery/clientHooks"
import { Toggle } from "./ui/toggle"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu"
import { useSearchClearSettings } from "@/lib/state/clearSearchOptions"
import { MultiBoxResponsive } from "./multiCombobox"
import { useMemo } from "react"

export function ClearSearch() {
    const { toast } = useToast()
    const reset = useResetSearchQueryState()
    const [embedArgs, setEmbedArgs] = useEmbedArgs()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const [options, setOptions] = useQueryOptions()
    const [tembFilter, setTembFilter] = useATSemanticText()
    const [iembFilter, setIembFilter] = useATSemanticImage()
    const clearSettings = useSearchClearSettings((state) => state)
    const clearSearchQuery = () => {
        const oldOrderArgs = orderArgs
        const oldOptions = options
        const oldTemFilter = tembFilter
        const oldIembFilter = iembFilter
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
        if (!clearSettings.searchTypes) {
            setOptions({
                at_e_path: oldOptions.at_e_path,
                at_e_txt: oldOptions.at_e_txt,
                at_e_si: oldOptions.at_e_si,
                at_e_st: oldOptions.at_e_st,
            })
            if (oldOptions.at_e_si) {
                setIembFilter({
                    model: oldIembFilter.model,

                })
            }
            if (oldOptions.at_e_st) {
                setTembFilter({
                    model: oldTemFilter.model,
                })
            }
            // Tag Search Mode
            if (oldOptions.tag_mode) {
                setOptions({
                    at_query: "",
                    tag_mode: true,
                    e_tags: true,
                })
            }
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
    const selectedOptions: string[] = useMemo(() => {
        let selected = []
        if (clearSettings.pageSize) {
            selected.push("page_size")
        }
        if (clearSettings.orderBy) {
            selected.push("order_by")
        }
        if (clearSettings.searchTypes) {
            selected.push("search_types")
        }
        if (clearSettings.modelCache) {
            selected.push("model_cache")
        }
        return selected
    }, [clearSettings.modelCache, clearSettings.orderBy, clearSettings.pageSize, clearSettings.searchTypes])

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