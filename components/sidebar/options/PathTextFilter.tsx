
import { useExtractedTextFilters, usePathTextFilters, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "@/components/TextSearchInput"
import { TextFilter } from "../base/TextFilter"
import { PathFilter } from "../base/PathTextFilter"

export function PathTextFilter() {
    const [filter, setFilter] = usePathTextFilters()
    const [options, setOptions] = useQueryOptions()
    return (
        <PathFilter
            enable={options.e_et}
            setEnable={(value) => setOptions({ e_et: value })}
            filter={filter}
            setFilter={setFilter}
            children={
                <ExtractedTextQueryInput />
            }
        />
    )
}

export function ExtractedTextQueryInput() {
    const [filter, setFilter] = usePathTextFilters()
    const setFts5Enabled = (value: boolean) => {
        setFilter({ raw_fts5_match: value })
        return true
    }
    return <TextSearchInput
        textQuery={filter.query}
        setTextQuery={(value) => setFilter({ query: value })}
        fts5Enabled={filter.raw_fts5_match}
        setFts5Enabled={setFts5Enabled}
        noClearSearch
        noTagCompletion
    />
}