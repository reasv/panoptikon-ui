"use client"

import { useDatabase, useDetailsPane, useImageSimilarity, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/use-toast"
import { SearchResultImage } from "@/components/SearchResultImage"
import { ComboBoxResponsive } from "@/components/combobox"
import { useState } from "react"

export function SimilarItemsSideBar() {
    const selected = useItemSelection((state) => state.getSelected())
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const maxClipResults = useImageSimilarity((state) => state.clipMaxResults)
    const selectedClipSetter = useImageSimilarity((state) => state.clipSetter)
    return (
        <div className="mt-4">
            <FilterContainer
                label={<span>CLIP Similarity</span>}
                description={<span>Similar items using CLIP embeddings</span>}
                storageKey="clip-similarity"
            >
                <CLIPSimilarityFilter setters={clipSetters} />
            </FilterContainer>
            <div className="mt-4">
                {selected && selectedClipSetter && (
                    <SimilarItemsView
                        item={selected}
                        setter_name={selectedClipSetter}
                        src_setter_names={[]}
                        limit={maxClipResults}
                    />)}
            </div>
        </div>
    )
}

export function CLIPSimilarityFilter({
    setters,
}: {
    setters: string[]
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    const selectedSetter = useImageSimilarity((state) => state.clipSetter || setters[0] || null)
    const setSelectedSetter = useImageSimilarity((state) => state.setClipSetter)
    const maxResults = useImageSimilarity((state) => state.clipMaxResults)
    const setMaxResults = useImageSimilarity((state) => state.setClipMaxResults)
    return (
        <div className="mt-4">
            <FilterContainer
                storageKey="clip-similarity-filter"
                label={<span>CLIP Filter</span>}
                description={
                    <span>Options for the similarity search</span>
                }
                defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <ComboBoxResponsive
                        options={setterOptions}
                        currentValue={selectedSetter}
                        onChangeValue={setSelectedSetter}
                        placeholder="No CLIP Model Selected"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Max Results Displayed</span>}
                    confidence={maxResults}
                    setConfidence={setMaxResults}
                    description={<span>'0' disables the similarity query</span>}
                    min={0}
                    max={50}
                    step={1}
                />
            </FilterContainer>
        </div>
    )
}

export function SimilarItemsView({
    item,
    setter_name,
    src_setter_names,
    limit
}: {
    item: components["schemas"]["FileSearchResult"]
    setter_name: string
    limit: number
    src_setter_names: string[]
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/similar/{sha256}/{setter_name}", {
        params: {
            query: {
                limit,
                src_setter_names,
                ...dbs
            },
            path: {
                sha256: item.sha256,
                setter_name
            }
        }
    }, {
        placeholderData: keepPreviousData
    })
    const onImageClick = (index: number) => {
        if (!data) return
        const item = data.results[index]
    }
    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
                        <SearchResultImage key={index} result={result} index={index} dbs={dbs} imageContainerClassName="h-96 xl:h-80 4xl:h-80 5xl:h-80" onImageClick={() => onImageClick(index)} />
                    ))}
                </div>
            )}
        </div>
    )
}