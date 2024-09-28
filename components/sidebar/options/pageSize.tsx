import { useOrderArgs } from "@/lib/state/searchQuery/clientHooks"
import { PageSizeControl } from "../base/PageSizeControl"
import { useItemSimilarityOptions } from "@/lib/state/similarityQuery/clientHooks"

export function PageSizeSlider() {
    const [orderArgs, setOrderArgs] = useOrderArgs()
    return (
        <PageSizeControl pageSize={orderArgs.page_size} setPageSize={(page_size) => setOrderArgs({
            page_size
        })} />
    )
}