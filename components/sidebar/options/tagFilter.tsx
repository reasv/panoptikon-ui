import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "../base/FilterContainer";
import { ConfidenceFilter } from "./confidenceFilter";
import { useSelectedDBs } from "@/lib/state/database";
import { ReactNode, useEffect, useRef, useState } from "react";
import { components } from "@/lib/panoptikon";
import { TagAutoComplete } from "@/components/tagInput";
import { Nullable, useQueryOptions, useMatchTags } from "@/lib/state/searchQuery/clientHooks";
import { SwitchFilter } from "../base/SwitchFilter";
import { KeymapComponents, MatchTagsArgs } from "@/lib/state/searchQuery/searchQueryKeyMaps";

type TagFilterUpdate = Nullable<Partial<KeymapComponents["MatchTags"]>>
type TagFilterType = Required<KeymapComponents["MatchTags"]>
export function TagFilter() {
    const [tagFilter, setTagFilter] = useMatchTags()
    const [options, setOptions] = useQueryOptions()

    function setTagFilterWrapper(newTagFilter: TagFilterUpdate) {
        console.log(tagFilter, newTagFilter)
        setTagFilter(newTagFilter)
    }
    function onEnableTagSearchMode(value: boolean) {
        setOptions({ e_tags: value, tag_mode: value })
        if (value) {
            setOptions({ at_query: "" })
        }
    }
    return (
        <FilterContainer
            storageKey="TagFilter" // Add a storageKey prop to make the localStorage key unique
            label={<span>Tags Filter</span>}
            description={
                <span>Returns items that match the given tags</span>
            }
        >
            <SwitchFilter
                label="Enable tag filter"
                description="Enable or disable the tag filter"
                value={options.e_tags}
                onChange={(value) => setOptions({ e_tags: value })}
            />
            <SwitchFilter
                label="Tag Search Mode"
                description="Replaces the top search bar with a tag search bar"
                value={options.tag_mode}
                onChange={(value) => onEnableTagSearchMode(value)}
            />
            <TagFilterSettings
                tagFilter={tagFilter}
                setTagFilter={setTagFilterWrapper}
            />
        </FilterContainer>
    )
}

// const tagSetStateValue = (tags: string[]) => tags.length > 0 ? tags : null
const tagSetStateValue = (tags: string[]) => tags

export function TagFilterSettings({
    tagFilter,
    setTagFilter,
}: {
    tagFilter: TagFilterType
    setTagFilter: (tagFilter: TagFilterUpdate) => void
}) {
    const dbs = useSelectedDBs()[0]
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const tagTargets = [{ value: "*", label: "All Tag Models" }, ...(
        data?.setters
            .filter((setter) => setter[0] === "tags")
            .map((setter) => ({ value: setter[1], label: setter[1] })) || [])
    ]
    const namespaces = [{ value: "*", label: "All Tag Namespaces" }, ...(
        data?.tags.namespaces
            .map((ns) => ({ value: ns, label: ns })) || [])
    ]

    return (
        <>
            <TagInputBox
                label="Positive Tags"
                description="Results must match all of these tags"
                tags={tagFilter.pos_match_all}
                onChange={(tags) => setTagFilter({ pos_match_all: tagSetStateValue(tags) })}
            />
            <TagInputBox
                label="Negative Tags"
                description="Results must *not* match *any* of these tags"
                tags={tagFilter.neg_match_any}
                onChange={(tags) => setTagFilter({ neg_match_any: tagSetStateValue(tags) })}
            />
            <TagInputBox
                label="Match-Any Tags"
                description="Results must match at least one of these tags"
                tags={tagFilter.pos_match_any}
                onChange={(tags) => setTagFilter({ pos_match_any: tagSetStateValue(tags) })}
            />
            <TagInputBox
                label="Negative Match-All Tags"
                description="Results must *not* match *all* of these tags"
                tags={tagFilter.neg_match_all}
                onChange={(tags) => setTagFilter({ neg_match_all: tagSetStateValue(tags) })}
            />
            <ConfidenceFilter
                label="Minimum Confidence"
                description="Only consider tags with this minimum confidence"
                confidence={tagFilter.min_confidence || 0}
                setConfidence={(value) => setTagFilter({ min_confidence: value || null })}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={tagTargets}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={(tagFilter.setters)}
                    onSelectionChange={(values) => setTagFilter({ setters: values })}
                    maxDisplayed={2}
                    placeholder="Models..."
                />
            </div>
            <SwitchFilter
                label="Require All Models"
                description="Only consider tags set by *all* chosen models"
                value={tagFilter.all_setters_required || false}
                onChange={(value) => setTagFilter({ all_setters_required: value })}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={namespaces}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={(tagFilter.namespaces)}
                    onSelectionChange={(values) => setTagFilter({ namespaces: values })}
                    maxDisplayed={2}
                    placeholder="Namespaces..."
                />
            </div>
        </>
    )
}


function splitTags(tags: string): string[] {
    return tags.split(" ").filter((tag) => tag !== "")
}

function joinTags(tags: string[]): string {
    return tags.join(" ")
}
function compareArrays(arr1: string[], arr2: string[]): boolean {
    return arr1.length === arr2.length &&
        arr1.every(item => arr2.includes(item));
}

function TagInputBox(
    {
        label,
        description,
        tags,
        onChange
    }:
        {
            label: ReactNode
            description?: ReactNode
            tags: string[]
            onChange: (tags: string[]) => void
        }
) {
    return <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
        <div className="flex flex-row items-center justify-between">
            <div className="space-y-0.5">
                <Label className="text-base">
                    {label}
                </Label>
                <div className="text-gray-400">
                    {description}
                </div>
            </div>
        </div>
        <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
            <TagListInput
                tags={tags}
                onChange={onChange}
            />
        </div>
    </div>
}
export function TagListInput({
    tags,
    onChange,
    onSubmit,
}:
    {
        tags: string[]
        onChange: (tags: string[]) => void
        onSubmit?: () => void
    }) {
    const [value, setValue] = useState<string>(joinTags(tags));

    // Track initial mount
    const isInitialMount = useRef(true);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
        } else {
            if (!compareArrays(tags, splitTags(value)))
                onChange(splitTags(value));
        }
    }, [value]);

    useEffect(() => {
        if (!compareArrays(splitTags(value), tags))
            setValue(joinTags(tags));
    }, [tags]);

    return (
        <TagAutoComplete
            placeholder="tag_1 tag_2 tag_3..."
            value={value}
            onChange={setValue}
            inputClassName="flex-grow"
            className="flex-grow"
            onSubmit={onSubmit}
        />
    )
}