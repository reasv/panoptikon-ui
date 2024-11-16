import { useATOptions, useMatchTags, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "./TextSearchInput"
import { ClearSearch } from "./ClearSearch"
import { Button } from "./ui/button"
import { LogOut } from "lucide-react"
import { TagListInput } from "./sidebar/options/tagFilter"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const anyTextQuery = useATOptions()
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

export function TagSearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const [tagFilter, setTagFilter] = useMatchTags()
    const [options, setOptions] = useQueryOptions()
    const onExitClick = () => {
        setOptions({ tag_mode: false, e_tags: false })
    }
    return (
        <>
            <Button onClick={onExitClick} title="Leave Tag Search Mode" variant="ghost" size="icon" className="mr-2">
                <LogOut className="h-4 w-4" />
            </Button>
            <div className="relative w-full">
                <TagListInput
                    tags={tagFilter.pos_match_all}
                    onChange={(tags) => setTagFilter({ pos_match_all: tags })}
                    onSubmit={onSubmit}
                />
            </div>
            <ClearSearch />
        </>
    )
}
