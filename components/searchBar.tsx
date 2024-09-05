import { useAnyTextFilterOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "./TextSearchInput"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const [anyTextQuery, setAnyTextQuery] = useAnyTextFilterOptions()
    const onEnableSyntax = (enabled: boolean) => {
        setAnyTextQuery({ raw_fts5_match: enabled })
        return true
    }
    return (
        <TextSearchInput
            onSubmit={onSubmit}
            textQuery={anyTextQuery.query}
            setTextQuery={(value) => setAnyTextQuery({ query: value })}
            fts5Enabled={anyTextQuery.raw_fts5_match}
            setFts5Enabled={(enabled) => onEnableSyntax(enabled)}
        />
    )
}
