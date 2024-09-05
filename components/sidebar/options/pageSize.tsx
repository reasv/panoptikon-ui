import { useSimilarityQuery } from "@/lib/state/similarityQuery"
import { useOrderArgs } from "@/lib/state/searchQuery/clientHooks"
import { PageSizeControl } from "../base/PageSizeControl"

export function PageSizeSlider() {
    const [orderArgs, setOrderArgs] = useOrderArgs()
    return (
        <PageSizeControl pageSize={orderArgs.page_size} setPageSize={(page_size) => setOrderArgs({
            page_size
        })} />
    )
}
export function SimilarityPageSizeSlider() {
    const [query, setQuery] = useSimilarityQuery()
    const setPageSize = (value: number) => setQuery({ is_page_size: value })
    return (
        <PageSizeControl pageSize={query.is_page_size} setPageSize={setPageSize} />
    )
}
