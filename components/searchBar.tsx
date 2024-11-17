import { useATOptions, useMatchTags, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { TextSearchInput } from "./TextSearchInput"
import { ClearSearch } from "./ClearSearch"
import { Button } from "./ui/button"
import { LogOut } from "lucide-react"
import { TagListInput } from "./sidebar/options/tagFilter"
import { TAG_PREFIXES } from "./tagInput"
import { useEffect, useState } from "react"

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

function combineTags({
    pos_match_all,
    neg_match_any,
    neg_match_all,
    pos_match_any
}: {
    pos_match_all: string[]
    neg_match_any: string[]
    neg_match_all: string[]
    pos_match_any: string[]
}) {
    const tags = [
        ...pos_match_all,
        ...neg_match_any.map((tag) => "-" + tag),
        ...neg_match_all.map((tag) => "~" + tag),
        ...pos_match_any.map((tag) => "*" + tag),
    ]
    return tags
}

function updateAllTags(allTags: string[], {
    pos_match_all,
    neg_match_any,
    neg_match_all,
    pos_match_any,
}: {
    pos_match_all: string[]
    neg_match_any: string[]
    neg_match_all: string[]
    pos_match_any: string[]
}): string[] {
    // Only make necessary changes to the tags list

    const tags = [
        ...pos_match_all,
        ...neg_match_any.map((tag) => "-" + tag),
        ...neg_match_all.map((tag) => "~" + tag),
        ...pos_match_any.map((tag) => "*" + tag),
    ]
    // Check if allTags contains all the tags
    // If not, add the missing tags to allTags
    // If there are extra tags in allTags, remove them
    // Preserve the order in allTags
    const newTags = tags.filter((tag) => !allTags.includes(tag))
    const removedTags = allTags.filter((tag) => !tags.includes(tag) && !TAG_PREFIXES.includes(tag))
    const newAllTags = allTags.filter((tag) => !removedTags.includes(tag)).concat(newTags)
    return newAllTags
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
    const [allTags, setAllTags] = useState<string[]>(combineTags(tagFilter))
    function setTags(tags: string[]) {
        const pos_match_all = tags.filter((tag) => !TAG_PREFIXES.includes(tag[0])).filter((tag) => tag.length > 0)
        const neg_match_any = tags.filter((tag) => tag[0] === "-")
            .map((tag) => tag.slice(1)).filter((tag) => tag.length > 0)
        const neg_match_all = tags.filter((tag) => tag[0] === "~")
            .map((tag) => tag.slice(1)).filter((tag) => tag.length > 0)

        const pos_match_any = tags.filter((tag) => tag[0] === "*")
            .map((tag) => tag.slice(1)).filter((tag) => tag.length > 0)

        setTagFilter({ pos_match_all, neg_match_any, neg_match_all, pos_match_any })
        setAllTags(tags)
    }
    useEffect(() => {
        setAllTags(updateAllTags(allTags, tagFilter))
    }, [tagFilter.pos_match_all, tagFilter.neg_match_any, tagFilter.neg_match_all, tagFilter.pos_match_any])
    return (
        <>
            <Button onClick={onExitClick} title="Leave Tag Search Mode" variant="ghost" size="icon" className="mr-2">
                <LogOut className="h-4 w-4" />
            </Button>
            <div className="relative w-full">
                <TagListInput
                    tags={allTags}
                    onChange={(tags) => setTags(tags)}
                    onSubmit={onSubmit}
                    placeholder="positive_tag -negative_tag ~match_all_negative_tag *match_any_positive_tag"
                />
            </div>
            <ClearSearch />
        </>
    )
}
