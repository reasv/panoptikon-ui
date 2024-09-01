"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { ComboBoxResponsive } from "../../combobox";
import { Input } from "../../ui/input";
import { MultiBoxResponsive } from "../../multiCombobox";
import { Slider } from "../../ui/slider";
import { ReactNode, useEffect, useState } from "react";
import { FilterContainer } from "./FilterContainer";
import { ConfidenceFilter } from "./confidenceFilter";
import { useSelectedDBs } from "@/lib/state/database";

export function AnyTextFilter() {
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)
    return (
        <FilterContainer
            storageKey="flexibleSearchContainer" // Add a storageKey prop to make the localStorage key unique
            label={<span>Flexible Search</span>}
            description={
                <span>Returns items that match any of these filters</span>
            }
        >
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Main Query
                        </Label>
                        <div className="text-gray-400">
                            The text query passed to all the Flexible Search filters
                        </div>
                    </div>
                </div>
                <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                    <Input
                        type="text"
                        placeholder="Type your query in the main search bar"
                        value={anyTextQuery}
                        className="flex-grow"
                        disabled
                    />
                </div>
            </div>
            <AnyTextPathFilter />
            <AnyTextETFilter />
        </FilterContainer>
    )
}

function AnyTextPathFilter() {
    const pathRestrictToFilename = useSearchQuery((state) => state.any_text.path_filter.only_match_filename)
    const enablePathFilter = useSearchQuery((state) => state.any_text.enable_path_filter)
    const setPathFilterEnabled = useSearchQuery((state) => state.setAnyTextPathFilterEnabled)
    const setPathFilterFilenameOnly = useSearchQuery((state) => state.setAnyTextPathFilterFilenameOnly)
    const onOptionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        if (option === "true") {
            setPathFilterFilenameOnly(true)
        } else {
            setPathFilterFilenameOnly(false)
        }
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Path Search
                    </Label>
                    <div className="text-gray-400">
                        Searches in the path and filename of files
                    </div>
                </div>
                <Switch checked={enablePathFilter} onCheckedChange={(value) => setPathFilterEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "true", label: "Filename Only" },
                        { value: "false", label: "Full Path" },
                    ]}
                    currentValue={pathRestrictToFilename ? "true" : "false"}
                    onChangeValue={onOptionSelected}
                    placeholder="Filename or Path..."
                />
            </div>
        </div>
    )
}

function AnyTextETFilter() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const enableETFilter = useSearchQuery((state) => state.any_text.enable_et_filter)
    const setETFilterEnabled = useSearchQuery((state) => state.setAnyTextETFilterEnabled)
    const targets = useSearchQuery((state) => state.any_text.et_filter.targets || [])
    const languages = useSearchQuery((state) => state.any_text.et_filter.languages || [])
    const setLanguages = useSearchQuery((state) => state.setAnyTextETFilterLanguages)
    const setTargets = useSearchQuery((state) => state.setAnyTextETFilterTargets)
    const minConfidence = useSearchQuery((state) => state.any_text.et_filter.min_confidence || 0)
    const setMinConfidence = useSearchQuery((state) => state.setAnyTextETFilterMinConfidence)
    const minLanguageConfidence = useSearchQuery((state) => state.any_text.et_filter.language_min_confidence || 0)
    const setMinLanguageConfidence = useSearchQuery((state) => state.setAnyTextETFilterMinLanguageConfidence)
    const textTargets = [{ value: "*", label: "All Sources" }, ...(
        data?.setters
            .filter((setter) => setter[0] === "text")
            .map((setter) => ({ value: setter[1], label: setter[1] })) || [])
    ]

    const textLanguages = [{ value: "*", label: "All Languages" }, ...(data?.text_stats.languages || []).map(lang => ({ value: lang, label: lang }))]
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Extracted Text Search
                    </Label>
                    <div className="text-gray-400">
                        Searches in all text extracted from items, including OCR and tags
                    </div>
                </div>
                <Switch checked={enableETFilter} onCheckedChange={(value) => setETFilterEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={textTargets}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={targets}
                    onSelectionChange={setTargets}
                    maxDisplayed={1}
                    placeholder="Targets..."
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
                    options={textLanguages}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={languages}
                    onSelectionChange={setLanguages}
                    maxDisplayed={1}
                    placeholder="Languages..."
                />
            </div>
            <ConfidenceFilter
                label={<span>Language Confidence Threshold</span>}
                confidence={minLanguageConfidence}
                setConfidence={setMinLanguageConfidence}
                description={<span>Minimum confidence for language detection</span>}
            />
        </div>
    )
}