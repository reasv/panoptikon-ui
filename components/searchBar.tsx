import { useAnyTextFilterOptions, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "./TextSearchInput"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const anyTextQuery = useAnyTextFilterOptions()
    const [options, setOptions] = useQueryOptions()
    const onEnableSyntax = (enabled: boolean) => {
        setOptions({ at_fts5: enabled })
        return true
    }
    return (
        <TextSearchInput
            onSubmit={onSubmit}
            textQuery={anyTextQuery.query}
            setTextQuery={(value) => setOptions({ at_query: value })}
            fts5Enabled={anyTextQuery.raw_fts5_match}
            setFts5Enabled={(enabled) => onEnableSyntax(enabled)}
        />
    )
}
