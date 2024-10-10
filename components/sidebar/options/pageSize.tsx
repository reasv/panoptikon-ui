import { usePageSize } from "@/lib/state/searchQuery/clientHooks"
import { PageSizeControl } from "../base/PageSizeControl"

export function PageSizeSlider() {
    const [pageSize, setPageSize] = usePageSize()
    return (
        <PageSizeControl
            pageSize={pageSize}
            setPageSize={setPageSize}
        />
    )
}