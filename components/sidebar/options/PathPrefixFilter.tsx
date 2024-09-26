import { $api } from "@/lib/api"
import { useCustomPaths } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { MultiBoxResponsive } from "../../multiCombobox";
import { Switch } from "../../ui/switch";
import { useSelectedDBs } from "@/lib/state/database";
import { useFileFilters, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";

export function PathPrefixFilter() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const [fileFilters, setFileFilters] = useFileFilters()
    const [options, setOptions] = useQueryOptions()
    const customPaths = useCustomPaths((state) => state.strings)
    const addCustomPath = useCustomPaths((state) => state.add)
    const removeCustomPath = useCustomPaths((state) => state.remove)

    const [inputValue, setInputValue] = useState('');

    function addNewCustomPath() {
        if (inputValue === '') return
        if (!fileFilters.paths.includes(inputValue)) {
            if (!customPaths.includes(inputValue)) {
                addCustomPath(inputValue)
            }
            setFileFilters({ paths: [...fileFilters.paths, inputValue] })
        }
        setInputValue('')
    }
    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            addNewCustomPath()
        }
    }
    function onClickAdd() {
        addNewCustomPath()
    }
    const allPaths = Array.from(new Set([
        "*",
        ...(data?.folders || []),
        ...(customPaths || []),
    ]));
    function onRemoveCustomPath(value: string) {
        setFileFilters({ paths: fileFilters.paths.filter((t) => t !== value) })
        removeCustomPath(value)
    }
    const isCustom = (path: string) => (!(data?.folders || []).includes(path)) && path !== "*"
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Path Prefix Filter
                    </Label>
                    <div className="text-gray-400">
                        Paths must start with one of these strings
                    </div>
                </div>
                <Switch checked={options.e_path} onCheckedChange={(value) => setOptions({ e_path: value })} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                <Input
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a path and press Enter" />
                <Button title="Add new path name" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={allPaths.map((ns) => ({ removable: isCustom(ns), value: ns, label: ns === "*" ? "Any Path Allowed" : ns })) || [{
                        value: "*",
                        label: "Any Path Allowed"
                    }]}
                    currentValues={fileFilters.paths}
                    onSelectionChange={(values) => setFileFilters({
                        paths: values
                    })}
                    placeholder="Select groups"
                    resetValue="*"
                    maxDisplayed={4}
                    onRemoveOption={onRemoveCustomPath}
                />
            </div>
        </div>
    )
}