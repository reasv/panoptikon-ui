import { useMatchPath, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "@/components/TextSearchInput"
import { PathFilter } from "../base/PathTextFilter"

export function PathTextFilter() {
    const [filter, setFilter] = useMatchPath()
    const [options, setOptions] = useQueryOptions()
    return (
        <PathFilter
            enable={options.e_pt}
            setEnable={(value) => setOptions({ e_pt: value })}
            filter={filter}
            setFilter={setFilter}
            children={
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                    <ExtractedTextQueryInput />
                </div>
            }
        />
    )
}

export function ExtractedTextQueryInput() {
    const [filter, setFilter] = useMatchPath()
    const setFts5Enabled = (value: boolean) => {
        setFilter({ raw_fts5_match: value })
        return true
    }
    return <TextSearchInput
        textQuery={filter.match}
        setTextQuery={(value) => setFilter({ match: value })}
        fts5Enabled={filter.raw_fts5_match}
        setFts5Enabled={setFts5Enabled}
        noClearSearch
        noTagCompletion
    />
}