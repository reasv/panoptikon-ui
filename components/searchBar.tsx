import { useAnyTextFilterOptions, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "./TextSearchInput"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const [anyTextQuery, setAnyTextQuery] = useAnyTextFilterOptions()
    const [options, setOptions] = useQueryOptions()
    const setTextQuery = (value: string, valid: boolean) => {
        setAnyTextQuery({ query: value })
        setOptions({ s_enable: valid })
    }
    const onEnableSyntax = (value: boolean, valid: boolean) => {
        setAnyTextQuery({ raw_fts5_match: value })
        setOptions({ s_enable: valid })
        return true
    }
    return (
        <TextSearchInput
            onSubmit={onSubmit}
            textQuery={anyTextQuery.query}
            setTextQuery={setTextQuery}
            fts5Enabled={options.at_fts5}
            setFts5Enabled={onEnableSyntax}
            setIsInputValid={(value) => setOptions({ s_enable: value })}
        />
    )
}
