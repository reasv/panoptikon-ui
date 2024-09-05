
import { useExtractedTextFilters, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "@/components/TextSearchInput"
import { TextFilter } from "../base/TextFilter"

export function ExtractedTextFilter() {
    const [filter, setFilter] = useExtractedTextFilters()
    const [options, setOptions] = useQueryOptions()
    return (
        <TextFilter
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
    const [filter, setFilter] = useExtractedTextFilters()
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
    />
}