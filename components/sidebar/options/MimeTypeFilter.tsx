"use client"
import { $api } from "@/lib/api"
import { useCustomMimes } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { MultiBoxResponsive } from "../../multiCombobox";
import { Switch } from "../../ui/switch";
import { useSelectedDBs } from "@/lib/state/database";
import { useFileFilters, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";

export function MimeTypeFilter() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const [fileFilters, setFileFilters] = useFileFilters()
    const [options, setOptions] = useQueryOptions()
    const customTypes = useCustomMimes((state) => state.strings)
    const addCustomMime = useCustomMimes((state) => state.add)
    const removeCustomMime = useCustomMimes((state) => state.remove)
    const [inputValue, setInputValue] = useState('');

    function addNewCustomMime() {
        if (inputValue === '') return
        if (!fileFilters.item_types.includes(inputValue)) {
            if (!customTypes.includes(inputValue)) {
                addCustomMime(inputValue)
            }
            setFileFilters({ item_types: [...fileFilters.item_types, inputValue] })
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
        setFileFilters({ item_types: fileFilters.item_types.filter((t) => t !== value) })
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
                <Switch checked={options.e_mime} onCheckedChange={(value) => setOptions({ e_mime: value })} />
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
                    currentValues={fileFilters.item_types}
                    onSelectionChange={(values) => setFileFilters({ item_types: values })}
                    placeholder="Select groups"
                    resetValue="*"
                    maxDisplayed={4}
                    onRemoveOption={onRemoveCustomMime}
                />
            </div>
        </div>
    )
}