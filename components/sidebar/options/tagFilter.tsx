"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { Input } from "../../ui/input";
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "./FilterContainer";
import { ConfidenceFilter } from "./confidenceFilter";
import { useSelectedDBs } from "@/lib/state/database";
import { ReactNode, useEffect, useState } from "react";
import { components } from "@/lib/panoptikon";

export function TagFilter() {
    const [tagFilter, setTagFilter] = useSearchQuery((state) => [state.tags, state.setTags])
    const [enabled, setEnabled] = useSearchQuery((state) => [state.e_tags, state.setEnableTags])
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
                value={enabled}
                onChange={setEnabled}
            />
            <TagFilterSettings
                tagFilter={tagFilter}
                setTagFilter={setTagFilter}
            />
        </FilterContainer>
    )
}

export function TagFilterSettings({
    tagFilter,
    setTagFilter,
}: {
    tagFilter: components["schemas"]["QueryTagFilters"]
    setTagFilter: (tagFilter: components["schemas"]["QueryTagFilters"]) => void
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
                tags={tagFilter.pos_match_all || []}
                onChange={(tags) => setTagFilter({ ...tagFilter, pos_match_all: tags })}
            />
            <TagListInput
                label="Negative Tags"
                description="Results must *not* match *any* of these tags"
                tags={tagFilter.neg_match_any || []}
                onChange={(tags) => setTagFilter({ ...tagFilter, neg_match_any: tags })}
            />
            <TagListInput
                label="Match-Any Tags"
                description="Results must match at least one of these tags"
                tags={tagFilter.pos_match_any || []}
                onChange={(tags) => setTagFilter({ ...tagFilter, pos_match_any: tags })}
            />
            <TagListInput
                label="Negative Match-All Tags"
                description="Results must *not* match *all* of these tags"
                tags={tagFilter.neg_match_all || []}
                onChange={(tags) => setTagFilter({ ...tagFilter, neg_match_all: tags })}
            />
            <ConfidenceFilter
                label="Minimum Confidence"
                description="Only consider tags with this minimum confidence"
                confidence={tagFilter.min_confidence || 0}
                setConfidence={(value) => setTagFilter({ ...tagFilter, min_confidence: value || null })}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={tagTargets}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={(tagFilter.setters || [])}
                    onSelectionChange={(values) => setTagFilter({ ...tagFilter, setters: values })}
                    maxDisplayed={2}
                    placeholder="Models..."
                />
            </div>
            <SwitchFilter
                label="Require All Models"
                description="Only consider tags set by *all* chosen models"
                value={tagFilter.all_setters_required || false}
                onChange={(value) => setTagFilter({ ...tagFilter, all_setters_required: value })}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={namespaces}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={(tagFilter.namespaces || [])}
                    onSelectionChange={(values) => setTagFilter({ ...tagFilter, namespaces: values })}
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
    const [value, setValue] = useState<string>(joinTags(tags))
    useEffect(() => {
        setValue(joinTags(tags))
    }, [tags])
    useEffect(() => {
        onChange(splitTags(value))
    }, [value])
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
                <Input
                    type="text"
                    placeholder="tag_1 tag_2 tag_3 ..."
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="flex-grow"
                />
            </div>
        </div>
    )
}