import { Label } from "../../ui/label"
import { ComboBoxResponsive } from "../../combobox";
import { components } from "@/lib/panoptikon";
import { useOrderArgs, useSearchQuery } from "@/lib/state/searchQuery/clientHooks";

export function OrderBy() {
    const query = useSearchQuery()
    const [_, setOrderArgs] = useOrderArgs()

    let orderOptions: {
        value: NonNullable<components["schemas"]["OrderParams"]["order_by"]>
        label: string
    }[] = [
            { value: "path", label: "Filename" },
            { value: "last_modified", label: "Last Modified" },
            { value: "time_added", label: "Bookmarking Time" },
            { value: "rank_any_text", label: "Flexible Search Match" },
        ]

    if (!query.query.filters!.any_text?.path || !query.query.filters!.any_text?.extracted_text) {
        orderOptions = orderOptions.filter((opt) => opt.value !== "rank_any_text")
    }
    if (!query.query.filters!.bookmarks?.restrict_to_bookmarks) {
        orderOptions = orderOptions.filter((opt) => opt.value !== "time_added")
    }

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
                    options={orderOptions}
                    currentValue={query.order_args.order_by}
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
                    currentValue={query.order_args.order!}
                    onChangeValue={onOrderChange}
                    placeholder="Select order"
                />
            </div>
        </div>
    )
}