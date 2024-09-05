"use client"
import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "./FilterContainer";
import { ConfidenceFilter } from "./confidenceFilter";
import { useSelectedDBs } from "@/lib/state/database";
import { ReactNode, useEffect, useRef, useState } from "react";
import { components } from "@/lib/panoptikon";
import { TagAutoComplete } from "@/components/tagInput";
import { useQueryOptions, useTagFilter } from "@/lib/state/searchQuery/clientHooks";

type TagFilterUpdate = Partial<components["schemas"]["QueryTagFilters"]>
type TagFilterType = Required<components["schemas"]["QueryTagFilters"]>
export function TagFilter() {
    const [tagFilter, setTagFilter] = useTagFilter()
    const [options, setOptions] = useQueryOptions()

    function setTagFilterWrapper(newTagFilter: TagFilterUpdate) {
        console.log(tagFilter, newTagFilter)
        setTagFilter(newTagFilter)
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
            <TagFilterSettings
                tagFilter={tagFilter}
                setTagFilter={setTagFilterWrapper}
            />
        </FilterContainer>
    )
}

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
            <TagListInput
                label="Positive Tags"
                description="Results must match all of these tags"
                tags={tagFilter.pos_match_all}
                onChange={(tags) => setTagFilter({ pos_match_all: tags })}
            />
            <TagListInput
                label="Negative Tags"
                description="Results must *not* match *any* of these tags"
                tags={tagFilter.neg_match_any}
                onChange={(tags) => setTagFilter({ neg_match_any: tags })}
            />
            <TagListInput
                label="Match-Any Tags"
                description="Results must match at least one of these tags"
                tags={tagFilter.pos_match_any}
                onChange={(tags) => setTagFilter({ pos_match_any: tags })}
            />
            <TagListInput
                label="Negative Match-All Tags"
                description="Results must *not* match *all* of these tags"
                tags={tagFilter.neg_match_all}
                onChange={(tags) => setTagFilter({ neg_match_all: tags })}
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

export function SwitchFilter({
    label,
    description,
    value,
    onChange,
}: {
    label: ReactNode
    description?: ReactNode
    value: boolean
    onChange: (value: boolean) => void
}) {
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
            <Switch checked={value} onCheckedChange={onChange} />
        </div>
    </div>
}

function splitTags(tags: string): string[] {
    return tags.split(" ").filter((tag) => tag !== "")
}

function joinTags(tags: string[]): string {
    return tags.join(" ")
}

export function TagListInput({
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
    }) {
    const [value, setValue] = useState<string>(joinTags(tags));

    // Track initial mount
    const isInitialMount = useRef(true);
    const hasLoadedTags = useRef(false);


    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
        } else {
            onChange(splitTags(value));
        }
    }, [value]);

    useEffect(() => {
        if (!hasLoadedTags.current && tags.length > 0) {
            setValue(joinTags(tags));
            hasLoadedTags.current = true;
        }
    }, [tags]);

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
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
                <TagAutoComplete
                    placeholder="tag_1 tag_2 tag_3..."
                    value={value}
                    onChange={setValue}
                    inputClassName="flex-grow"
                    className="flex-grow"
                />
            </div>
        </div>
    )
}