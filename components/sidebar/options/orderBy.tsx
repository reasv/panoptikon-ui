import { Label } from "../../ui/label"
import { ComboBoxResponsive } from "../../combobox";
import { useOrderArgs, useOrderBy, useSearchQuery } from "@/lib/state/searchQuery/clientHooks";
import { orderByType } from "@/lib/state/searchQuery/searchQueryKeyMaps";

export function OrderBy() {
    const orderByData = useOrderBy()
    const query = useSearchQuery()
    const [_, setOrderArgs] = useOrderArgs()

    const filterOrderOptions = [
        { value: "bookmark_time", label: "Bookmarking Time" },
        { value: "match_at", label: "Flexible Search Match" },
        { value: "match_text", label: "Text Match" },
        { value: "match_path", label: "Path Match" },
        { value: "match_tags_confidence", label: "Tag Match" },
        { value: "search_semantic_text", label: "Semantic Text Match" },
        { value: "search_semantic_image", label: "Semantic Image Match" },
        { value: "search_item_similarity", label: "Item Similarity Match" },
    ]

    const availableFilterOrderOptions = filterOrderOptions.filter(
        (opt) => orderByData.meta.available_filter_orders.includes(opt.value)
    )
    let orderOptions: {
        value: NonNullable<orderByType>
        label: string
    }[] = [
            { value: "path", label: "Filename" },
            { value: "last_modified", label: "Last Modified" },
            { value: "size", label: "Size" },
            { value: "type", label: "Type" },
            { value: "duration", label: "Duration" },
            { value: "random", label: "Random Order" },
            { value: "time_added", label: "Time Added" },
        ]
    const orderOptionsMap = orderByData.meta.force_order_by ? availableFilterOrderOptions : [
        ...orderOptions,
        ...availableFilterOrderOptions
    ]

    function onOrderByChange(value: string | null) {
        if (value) {
            // @ts-ignore
            setOrderArgs({ order_by: value })
        }
    }

    function onOrderChange(value: string | null) {
        // @ts-ignore
        setOrderArgs({ order: value })
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Order By
                    </Label>
                    <div className="text-gray-400">
                        Choose the order of the search results
                    </div>
                </div>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={orderOptionsMap}
                    currentValue={orderByData.meta.actual_order_by}
                    onChangeValue={onOrderByChange}
                    placeholder="Select order by"
                />
                <ComboBoxResponsive
                    options={[
                        { value: "asc", label: "Ascending" },
                        { value: "desc", label: "Descending" },
                        { value: "default", label: "Default" },
                    ]}
                    resetValue="default"
                    currentValue={query.order_by![0].order!}
                    onChangeValue={onOrderChange}
                    placeholder="Default Order"
                />
            </div>
        </div>
    )
}