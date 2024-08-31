"use client"
import { useSearchQuery } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { ComboBoxResponsive } from "../../combobox";

export function OrderBy() {
    const orderBy = useSearchQuery((state) => state.getOrderBy())
    const setOrderBy = useSearchQuery((state) => state.setOrderBy)
    const order = useSearchQuery((state) => state.order_args.order || "default")
    const setOrder = useSearchQuery((state) => state.setOrder)
    const isAnyTextEnabled = useSearchQuery((state) => state.getIsAnyTextEnabled())
    const restrictToBookmarks = useSearchQuery((state) => state.bookmarks.restrict_to_bookmarks)
    let orderOptions: {
        value: | "last_modified"
        | "path"
        | "rank_fts"
        | "rank_path_fts"
        | "time_added"
        | "rank_any_text"
        | "text_vec_distance"
        | "image_vec_distance"
        label: string
    }[] = [
            { value: "path", label: "Filename" },
            { value: "last_modified", label: "Last Modified" },
            { value: "time_added", label: "Bookmarking Time" },
            { value: "rank_any_text", label: "Flexible Search Match" },
        ]

    if (!isAnyTextEnabled) {
        orderOptions = orderOptions.filter((opt) => opt.value !== "rank_any_text")
    }
    if (!restrictToBookmarks) {
        orderOptions = orderOptions.filter((opt) => opt.value !== "time_added")
    }

    function onOrderByChange(value: string | null) {
        if (value) {
            // @ts-ignore
            setOrderBy(value)
        }
    }

    function onOrderChange(value: string | null) {
        // @ts-ignore
        setOrder(value)
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
                    options={orderOptions}
                    currentValue={orderBy}
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
                    currentValue={order}
                    onChangeValue={onOrderChange}
                    placeholder="Select order"
                />
            </div>
        </div>
    )
}