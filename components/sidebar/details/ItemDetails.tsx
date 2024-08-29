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
export function ItemDetails() {
    const selected = useItemSelection((state) => state.getSelected())
    return (
        <div className="mt-4">
            <ExtractedText item={selected} />
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
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs } })

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
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <ExtractedTextList
                        item={item}
                        selectedSetters={selectedSetters}
                        selectedLanguages={selectedLanguages}
                        minConfidence={minConfidence}
                        minLanguageConfidence={minLanguageConfidence}
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
        minLanguageConfidence
    }: {
        item: components["schemas"]["FileSearchResult"],
        selectedSetters: string[],
        selectedLanguages: string[],
        minConfidence: number,
        minLanguageConfidence: number,
    }
) {
    const { data } = $api.useQuery("get", "/api/items/text/{sha256}", {
        params: {
            path: {
                sha256: item?.sha256,
            }
        }
    })
    const text = (
        data?.text
            .filter((t) => selectedSetters.length == 0 || selectedSetters.includes(t.setter_name))
            .filter((t) => selectedLanguages.length == 0 || selectedLanguages.includes(t.language))
            .filter((t) => minConfidence > 0 ? (t.confidence || 0) >= minConfidence : true)
            .filter((t) => minLanguageConfidence > 0 ? (t.language_confidence || 0) >= minLanguageConfidence : true)
    ) || []
    return (
        <div className="mt-4">
            {text.map((t, i) => (
                <div key={`${t.item_sha256}-${i}`} className="border-b border-gray-200 py-2">
                    {t.setter_name}: {t.text}
                </div>
            ))}
        </div>
    )
}