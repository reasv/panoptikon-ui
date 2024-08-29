"use client"
import { $api } from "@/lib/api"
import { useBookmarkCustomNs, useBookmarkNs, useDatabase } from "@/lib/zust"
import { Label } from "../../ui/label"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { ComboBoxResponsive } from "../../combobox";

export function SwitchBookmarkNs() {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/bookmarks/ns", {
        params: {
            query: dbs
        }
    })
    const customNs = useBookmarkCustomNs((state) => state.namespaces)
    const namespace = useBookmarkNs((state) => state.namespace)
    const [inputValue, setInputValue] = useState('');
    const setBookmarks = useBookmarkNs((state) => state.setBookmarks)
    const addBookmarkCustomNs = useBookmarkCustomNs((state) => state.addNs)
    function setBookmarkCustomNs(ns: string) {
        addBookmarkCustomNs(ns)
        setBookmarks(ns)
    }
    const mergedNamespaces = Array.from(new Set([
        ...(data?.namespaces || []),
        ...(customNs || []),
        namespace
    ]));
    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter' && inputValue !== '') {
            setBookmarkCustomNs(inputValue)
            setInputValue('')
        }
    }
    function onClickAdd() {
        if (inputValue === '') return
        setBookmarkCustomNs(inputValue)
        setInputValue('')
    }
    function onSelectOption(option: string | null) {
        if (option === null) return
        setBookmarks(option)
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="space-y-0.5">
                <Label className="text-base">
                    Bookmarks Group
                </Label>
                <div className="text-gray-400">
                    New bookmarks will be added to this group
                </div>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-center">
                <ComboBoxResponsive
                    options={mergedNamespaces.map((ns) => ({ value: ns, label: ns }))}
                    currentValue={namespace}
                    onChangeValue={onSelectOption}
                    placeholder="Groups..."
                />
                <Input
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a new name and press Enter" />
                <Button title="Add new group name" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}