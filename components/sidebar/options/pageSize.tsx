import { usePageSize } from "@/lib/state/searchQuery/clientHooks"
import { useCommitPageSize } from "@/lib/searchHooks"
import { PageSizeControl } from "../base/PageSizeControl"

export function PageSizeSlider() {
    const pageSize = usePageSize()
    // Not a plain param write: the change is remapped onto the item the user
    // is looking at, and the page holding it is prefetched before the URL
    // moves (see useCommitPageSize)
    const setPageSize = useCommitPageSize()
    return (
        <PageSizeControl
            pageSize={pageSize}
            setPageSize={setPageSize}
        />
    )
}
