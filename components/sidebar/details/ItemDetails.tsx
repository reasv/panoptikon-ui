"use client"

import { useDatabase, useDetailsPane, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { Label } from "@/components/ui/label"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { $api } from "@/lib/api"
import { useState } from "react"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"

export function ItemDetails() {
    const selected = useItemSelection((state) => state.getSelected())
    return (
        <div className="mt-4">
            <ExtractedText item={selected} />
            <ItemTagDetails item={selected} />
            <ResetFilters />
        </div>
    )
}

function ResetFilters() {
    const resetFilters = useDetailsPane((state) => state.resetFilters)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">Reset Filters</div>
                    <div className="text-gray-400">Reset all filters on file details</div>
                </div>
                <Button
                    title="Clear all detail filters"
                    variant="ghost"
                    size="icon"
                    onClick={() => resetFilters()}
                >
                    <Delete
                        className="h-4 w-4"
                    />
                </Button>
            </div>
        </div>
    )
}

function ExtractedText({
    item,
}: {
    item: components["schemas"]["FileSearchResult"] | null
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })

    const textSetters = ["*", ...data?.setters.filter((s) => s[0] === "text").map((s) => s[1]) || []]
    const setterOptions = textSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Text Sources" : setter }))
    const selectedSetters = useDetailsPane((state) => state.text_setters)
    const setSelectedSetters = useDetailsPane((state) => state.setTextSetters)

    const textLanguages = ["*", ...data?.text_stats.languages || []]
    const languageOptions = textLanguages.map((setter) => ({ value: setter, label: setter === "*" ? "All Languages" : setter }))
    const setSelectedLanguages = useDetailsPane((state) => state.setTextLanguages)
    const setMinConfidence = useDetailsPane((state) => state.setMinConfidence)
    const minConfidence = useDetailsPane((state) => state.text_min_confidence)
    const setMinLanguageConfidence = useDetailsPane((state) => state.setMinLanguageConfidence)
    const minLanguageConfidence = useDetailsPane((state) => state.min_language_confidence)
    const selectedLanguages = useDetailsPane((state) => state.text_languages)
    const maxTextLength = useDetailsPane((state) => state.text_max_length)
    const setMaxTextLength = useDetailsPane((state) => state.setTextMaxLength)
    return (
        <FilterContainer
            storageKey="extractedTextdetailOpen"
            label={<span>Extracted Text</span>}
            description={
                <span>Text extracted from this item</span>
            }
        >
            <FilterContainer
                storageKey="extractedTextdetailFilterOpen"
                label={<span>Text Filters</span>}
                description={
                    <span>Filter the displayed text</span>
                }
                defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={setterOptions}
                        currentValues={selectedSetters}
                        onSelectionChange={setSelectedSetters}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Confidence Threshold</span>}
                    confidence={minConfidence}
                    setConfidence={setMinConfidence}
                    description={<span>Minimum confidence for the extracted text</span>}
                />
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={languageOptions}
                        currentValues={selectedLanguages}
                        onSelectionChange={setSelectedLanguages}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Language Confidence Threshold</span>}
                    confidence={minLanguageConfidence}
                    setConfidence={setMinLanguageConfidence}
                    description={<span>Minimum confidence for language detection</span>}
                />
                <ConfidenceFilter
                    label={<span>Truncation Length</span>}
                    confidence={maxTextLength}
                    setConfidence={setMaxTextLength}
                    description={<span>Cut text off after n characters</span>}
                    min={0}
                    max={5000}
                    step={10}
                />
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <ExtractedTextList
                        item={item}
                        selectedSetters={selectedSetters}
                        selectedLanguages={selectedLanguages}
                        minConfidence={minConfidence}
                        minLanguageConfidence={minLanguageConfidence}
                        maxLength={maxTextLength}
                    />)}
            </div>
        </FilterContainer>
    )
}

function ExtractedTextList(
    {
        item,
        selectedSetters,
        selectedLanguages,
        minConfidence,
        minLanguageConfidence,
        maxLength
    }: {
        item: components["schemas"]["FileSearchResult"],
        selectedSetters: string[],
        selectedLanguages: string[],
        minConfidence: number,
        minLanguageConfidence: number,
        maxLength: number
    }
) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/items/text/{sha256}", {
        params: {
            path: {
                sha256: item?.sha256,
                ...dbs
            },
            query: {
                setters: selectedSetters,
                truncate_length: maxLength ? maxLength : undefined,
            }
        }
    },
        {
            placeholderData: keepPreviousData
        }
    )
    const text = (
        data?.text
            .filter((t) => selectedLanguages.length == 0 || selectedLanguages.includes(t.language))
            .filter((t) => minConfidence > 0 ? (t.confidence || 0) >= minConfidence : true)
            .filter((t) => minLanguageConfidence > 0 ? (t.language_confidence || 0) >= minLanguageConfidence : true)
    ) || []
    return (
        <div className="mt-4">
            {text.map((t, i) => (
                <ExtractedTextCard key={`${t.setter_name}-${i}`} text={t} />
            ))}
        </div>
    )
}

function ExtractedTextCard(
    {
        text,
    }: {
        text: components["schemas"]["ExtractedText"]
    }
) {
    const truncatedCharNumber = text.length - text.text.length
    const omittedDisplay = truncatedCharNumber > 0 ? "... " + (`(${truncatedCharNumber} omitted)`) : ''
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{text.setter_name} <span className="text-gray-400"> {text.language}</span></div>
                    <div className="text-gray-400 p-1 select-text ">{text.text}<i>{omittedDisplay}</i></div>
                    <div className="text-gray-400 font-medium">Confidence: {text.confidence} (Language: {text.language_confidence})</div>
                </div>
            </div>
        </div>
    )
}


function ItemTagDetails({
    item,
}: {
    item: components["schemas"]["FileSearchResult"] | null
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })

    const tagSetters = ["*", ...data?.setters.filter((s) => s[0] === "tags").map((s) => s[1]) || []]
    const setterOptions = tagSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Tag Sources" : setter }))
    const selectedSetters = useDetailsPane((state) => state.tag_setters)
    const setSelectedSetters = useDetailsPane((state) => state.setTagSetters)

    const tagNamespaces = ["*", ...data?.tags.namespaces || []]
    const nsOptions = tagNamespaces.map((ns) => ({ value: ns, label: ns === "*" ? "All Namespaces" : ns }))
    const setSelectedNamespaces = useDetailsPane((state) => state.setTagNamespaces)
    const setMinConfidence = useDetailsPane((state) => state.setTagMinConfidence)
    const minConfidence = useDetailsPane((state) => state.tag_min_confidence)

    const selectedTagNs = useDetailsPane((state) => state.tag_namespaces)
    const maxTagsNsSetters = useDetailsPane((state) => state.tags_max_per_ns_setter)
    const setMaxTagsNsSetters = useDetailsPane((state) => state.setTagsMaxPerNsSetter)
    return (
        <FilterContainer
            storageKey="tagsDetailOpen"
            label={<span>Tags</span>}
            description={
                <span>Tags added to this item</span>
            }
        >
            <FilterContainer
                storageKey="tagsDetailFilterOpen"
                label={<span>Tag Filters</span>}
                description={
                    <span>Filter the tags shown</span>
                }
                defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={setterOptions}
                        currentValues={selectedSetters}
                        onSelectionChange={setSelectedSetters}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Confidence Threshold</span>}
                    confidence={minConfidence}
                    setConfidence={setMinConfidence}
                    description={<span>Minimum confidence for the tags to be displayed</span>}
                />
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={nsOptions}
                        currentValues={selectedTagNs}
                        onSelectionChange={setSelectedNamespaces}
                        placeholder="Select Namespaces"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Max Tags Per Namespace</span>}
                    confidence={maxTagsNsSetters}
                    setConfidence={setMaxTagsNsSetters}
                    description={<span>Cut off lower confidence tags beyond this limit</span>}
                    min={0}
                    max={100}
                    step={10}
                />
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <ItemTags
                        item={item}
                        namespaces={selectedTagNs}
                        setters={selectedSetters}
                        minConfidence={minConfidence}
                        maxTagsPerNsSetter={maxTagsNsSetters}
                    />)}
            </div>
        </FilterContainer>
    )
}

function ItemTags(
    {
        item,
        setters,
        namespaces,
        minConfidence,
        maxTagsPerNsSetter
    }: {
        item: components["schemas"]["FileSearchResult"],
        setters: string[],
        namespaces: string[],
        minConfidence: number,
        maxTagsPerNsSetter: number
    }
) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/items/tags/{sha256}", {
        params: {
            path: {
                sha256: item?.sha256,
            },
            query: {
                setters,
                namespaces,
                confidence_threshold: minConfidence,
                limit_per_namespace: maxTagsPerNsSetter,
                ...dbs
            }
        }
    },
        {
            placeholderData: keepPreviousData
        }
    )
    const tags = data?.tags || []
    return (
        <div className="mt-4">
            {tags.map((t, i) => (
                <div key={i}></div>
            ))}
        </div>
    )
}

function TagDisplay(
    {
        text,
    }: {
        text: components["schemas"]["ExtractedText"]
    }
) {
    const truncatedCharNumber = text.length - text.text.length
    const omittedDisplay = truncatedCharNumber > 0 ? "... " + (`(${truncatedCharNumber} omitted)`) : ''
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{text.setter_name} <span className="text-gray-400"> {text.language}</span></div>
                    <div className="text-gray-400 p-1 select-text ">{text.text}<i>{omittedDisplay}</i></div>
                    <div className="text-gray-400 font-medium">Confidence: {text.confidence} (Language: {text.language_confidence})</div>
                </div>
            </div>
        </div>
    )
}
