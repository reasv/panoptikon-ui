
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
    const syntaxEnabled = filter.raw_fts5_match

    function onSetTextQuery(value: string, valid: boolean) {
        setFilter({ query: value })
        // TODO valid
    }

    function onInputValid(valid: boolean) {
        // TODO
    }

    function onEnableSyntax(value: boolean, valid: boolean) {
        setFilter({ raw_fts5_match: value })
        // TODO valid
        return true
    }
    return <TextSearchInput
        textQuery={filter.query}
        setTextQuery={onSetTextQuery}
        fts5Enabled={syntaxEnabled}
        setFts5Enabled={onEnableSyntax}
        setIsInputValid={onInputValid}
    />
}