"use client"
import { $api } from "@/lib/api"
import { useCustomPaths, useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Input } from "./ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { MultiBoxResponsive } from "./multiCombobox";
import { Switch } from "./ui/switch";

export function PathPrefixFilter() {
    const { data } = $api.useQuery("get", "/api/search/stats")
    const paths = useSearchQuery((state) => state.paths)
    const setPaths = useSearchQuery((state) => state.setPaths)
    const customPaths = useCustomPaths((state) => state.strings)
    const addCustomPath = useCustomPaths((state) => state.add)
    const removeCustomPath = useCustomPaths((state) => state.remove)
    const pathsEnabled = useSearchQuery((state) => state.e_path)
    const setPathsEnabled = useSearchQuery((state) => state.setEnablePaths)
    const [inputValue, setInputValue] = useState('');

    function addNewCustomPath() {
        if (inputValue === '') return
        if (!paths.includes(inputValue)) {
            addCustomPath(inputValue)
            setPaths([...paths, inputValue])
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
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Path Prefix Filter
                    </Label>
                    <div className="text-gray-400">
                        Paths must start with one of these
                    </div>
                </div>
                <Switch checked={pathsEnabled} onCheckedChange={(value) => setPathsEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-center mb-3">
                <Input
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a path and press Enter" />
                <Button title="Add new path name" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
            <MultiBoxResponsive
                options={allPaths.map((ns) => ({ value: ns, label: ns === "*" ? "Any Path Allowed" : ns })) || [{
                    value: "*",
                    label: "Any Path Allowed"
                }]}
                currentValues={paths}
                onSelectionChange={setPaths}
                placeholder="Select groups"
                resetValue="*"
                maxDisplayed={4}
            />
        </div>
    )
}