
import { useMatchText, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "@/components/TextSearchInput"
import { TextFilter } from "../base/TextFilter"
import { usePartitionBy } from "@/lib/state/partitionBy"
import { SwitchFilter } from "../base/SwitchFilter"

export function PartitionByOption() {
    const [partitionBy, setPartitionBy] = usePartitionBy()
    return (
        <SwitchFilter
            label="Unique Items Mode"
            description="Dedupe results by hash"
            value={!(partitionBy.partition_by === null)}
            onChange={(value) => setPartitionBy({ partition_by: value ? ["item_id"] : null })}
        />
    )
}