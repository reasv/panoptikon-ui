"use client"

import { useDatabase, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { Label } from "@/components/ui/label"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { $api } from "@/lib/api"
import { useState } from "react"
import { ConfidenceFilter } from "../options/confidenceFilter"

export function ItemDetails() {
    const selected = useItemSelection((state) => state.getSelected())
    return (
        <div className="mt-4">
            <ExtractedText item={selected} />
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
    const [selectedSetters, setSelectedSetters] = useState<string[]>([])
    const textLanguages = ["*", ...data?.text_stats.languages || []]
    const languageOptions = textLanguages.map((setter) => ({ value: setter, label: setter === "*" ? "All Languages" : setter }))
    const [selectedLanguages, setSelectedLanguages] = useState<string[]>([])
    const [minConfidence, setMinConfidence] = useState(0)
    const [minLanguageConfidence, setMinLanguageConfidence] = useState(0)
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
                {item && <ExtractedTextList item={item} selectedSetters={selectedSetters} />}
            </div>
        </FilterContainer>
    )
}

function ExtractedTextList(
    { item, selectedSetters }: {
        item: components["schemas"]["FileSearchResult"],
        selectedSetters: string[],
    }
) {
    const { data } = $api.useQuery("get", "/api/items/text/{sha256}", {
        params: {
            path: {
                sha256: item?.sha256,
            }
        }
    })
    const text = data?.text.filter((t) => selectedSetters.length == 0 || selectedSetters.includes(t.setter_name)) || []
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