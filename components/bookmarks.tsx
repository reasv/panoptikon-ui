"use client"
import { $api } from "@/lib/api"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookmarkCustomNs, useBookmarkNs } from "@/lib/zust"
import { Label } from "./ui/label"
import { Input } from "./ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";

export function SwitchBookmarkNs() {
    const { data } = $api.useQuery("get", "/api/bookmarks/ns")
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
    return (
        <>
            <Label htmlFor="indexSelect">Group bookmarks are saved in</Label>
            <div id="indexSelect" className="flex items-center space-x-2 mt-3 mb-4">
                <Select value={namespace} onValueChange={(value) => setBookmarks(value)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Search in..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>Bookmark Groups</SelectLabel>
                            {
                                mergedNamespaces.map((ns) => (
                                    <SelectItem key={ns} value={ns}>{ns}</SelectItem>
                                ))
                            }
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <Input
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a new name and press Enter" />
                <Button title="Add new group name" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </>
    )
}