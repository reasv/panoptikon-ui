"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch";
import { ComboBoxResponsive } from "./combobox";
import { Input } from "./ui/input";
import { MultiBoxResponsive } from "./multiCombobox";
import { Slider } from "./ui/slider";
import { useEffect, useState } from "react";

export function AnyTextFilter() {
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Flexible Search
                    </Label>
                    <div className="text-gray-400">
                        Returns items that match any of these filters
                    </div>
                </div>
            </div>
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
        </div>
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
                        Path Filter
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
    const { data } = $api.useQuery("get", "/api/search/stats")
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
    const [confidenceSlider, setConfidenceSlider] = useState([minConfidence])
    const [languageConfidenceSlider, setLanguageConfidenceSlider] = useState([minLanguageConfidence])
    const updateConfidence = (value: number[]) => {
        setMinConfidence(value[0])
    }
    const updateLanguageConfidence = (value: number[]) => {
        console.log(value[0])
        setMinLanguageConfidence(value[0])
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Extracted Text Filter
                    </Label>
                    <div className="text-gray-400">
                        Searches in all text extracted from items, including OCR and tags
                    </div>
                </div>
                <Switch checked={enableETFilter} onCheckedChange={(value) => setETFilterEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <MultiBoxResponsive
                    options={textTargets}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={targets}
                    onSelectionChange={setTargets}
                    maxDisplayed={1}
                    placeholder="Targets..."
                />
                <MultiBoxResponsive
                    options={textLanguages}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={languages}
                    onSelectionChange={setLanguages}
                    maxDisplayed={1}
                    placeholder="Languages..."
                />
            </div>
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Confidence Threshold
                        </Label>
                        <div className="text-gray-400">
                            Minimum confidence for the extracted text
                        </div>
                    </div>
                    <div className="text-lg">{confidenceSlider}</div>
                </div>
                <Slider
                    value={confidenceSlider}
                    onValueChange={setConfidenceSlider}
                    onValueCommit={updateConfidence}
                    max={1}
                    min={0}
                    step={0.01}
                    className="mt-4"
                />
            </div>
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Language Confidence Threshold
                        </Label>
                        <div className="text-gray-400">
                            Minimum confidence for language detection
                        </div>
                    </div>
                    <div className="text-lg">{languageConfidenceSlider}</div>
                </div>
                <Slider
                    value={languageConfidenceSlider}
                    onValueChange={setLanguageConfidenceSlider}
                    onValueCommit={updateLanguageConfidence}
                    max={1}
                    min={0}
                    step={0.01}
                    className="mt-4"
                />
            </div>
        </div>
    )
}