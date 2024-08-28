"use client"
import { $api } from "@/lib/api"
import { useCustomMimes, useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Input } from "./ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { MultiBoxResponsive } from "./multiCombobox";
import { Switch } from "./ui/switch";

export function MimeTypeFilter() {
    const { data } = $api.useQuery("get", "/api/search/stats")
    const types = useSearchQuery((state) => state.types)
    const setTypes = useSearchQuery((state) => state.setTypes)
    const customTypes = useCustomMimes((state) => state.strings)
    const addCustomMime = useCustomMimes((state) => state.add)
    const removeCustomMime = useCustomMimes((state) => state.remove)
    const mimesEnabled = useSearchQuery((state) => state.e_types)
    const setMimesEnabled = useSearchQuery((state) => state.setEnableTypes)
    const [inputValue, setInputValue] = useState('');

    function addNewCustomMime() {
        if (inputValue === '') return
        if (!types.includes(inputValue)) {
            if (!customTypes.includes(inputValue)) {
                addCustomMime(inputValue)
            }
            setTypes([...types, inputValue])
        }
        setInputValue('')
    }
    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            addNewCustomMime()
        }
    }
    function onClickAdd() {
        addNewCustomMime()
    }
    function onRemoveCustomMime(value: string) {
        setTypes(types.filter((t) => t !== value))
        removeCustomMime(value)
    }
    const allMimes = Array.from(new Set([
        "*",
        ...(data?.files.mime_types || []),
        ...(customTypes || []),
    ]));
    const isCustom = (mime: string) => (!(data?.files.mime_types || []).includes(mime)) && mime !== "*"
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Mime Type Filter
                    </Label>
                    <div className="text-gray-400">
                        Mime Type must start with one of these strings
                    </div>
                </div>
                <Switch checked={mimesEnabled} onCheckedChange={(value) => setMimesEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                <Input
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a mime type or prefix and press Enter" />
                <Button title="Add new type" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={allMimes.map((ns) => ({ removable: isCustom(ns), value: ns, label: ns === "*" ? "Any Type Allowed" : ns })) || [{
                        value: "*",
                        label: "Any Path Allowed"
                    }]}
                    currentValues={types}
                    onSelectionChange={setTypes}
                    placeholder="Select groups"
                    resetValue="*"
                    maxDisplayed={4}
                    onRemoveOption={onRemoveCustomMime}
                />
            </div>
        </div>
    )
}