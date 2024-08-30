"use client"
import { $api } from "@/lib/api"
import { useBookmarkCustomNs, useBookmarkNs, useDatabase } from "@/lib/zust"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "../options/FilterContainer";
import { components } from "@/lib/panoptikon";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";

export function FileBookmarks({
    item,
}: {
    item: components["schemas"]["FileSearchResult"]
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/bookmarks/ns", {
        params: {
            query: dbs
        }
    })
    const bookmarkQuery = {
        params: {
            path: {
                sha256: item.sha256
            },
            query: dbs
        }
    }
    const fileBookmarks = $api.useQuery("get", "/api/bookmarks/item/{sha256}", bookmarkQuery, {
        placeholderData: keepPreviousData
    })
    const bookmarkPath = "/api/bookmarks/ns/{namespace}/{sha256}"
    const addBookmarkMut = $api.useMutation(
        "put",
        bookmarkPath,
    );

    const removeBookmarkMut = $api.useMutation(
        "delete",
        bookmarkPath,
    );
    const getQueryKeys = (ns: string) => {
        const keys = []
        keys.push(["get",
            "/api/bookmarks/item/{sha256}",
            bookmarkQuery
        ])
        const params = { path: { namespace: ns, sha256: item.sha256 }, query: dbs }
        keys.push(
            [
                "get",
                bookmarkPath,
                { params },
            ]
        )
        return keys
    }
    const customNs = useBookmarkCustomNs((state) => state.namespaces)
    const mainNamespace = useBookmarkNs((state) => state.namespace)
    const [inputValue, setInputValue] = useState('');
    const addBookmarkCustomNs = useBookmarkCustomNs((state) => state.addNs)
    function setBookmarkCustomNs(ns: string) {
        addBookmarkCustomNs(ns)
    }

    const mergedNamespaces = Array.from(new Set([
        ...(data?.namespaces || []),
        ...(customNs || []),
        mainNamespace,
    ]));
    const queryClient = useQueryClient()
    const { toast } = useToast()

    function changeBookmarks(ns: string, deleted: boolean) {
        const onSuccess = () => {
            getQueryKeys(ns).forEach((k) => queryClient.invalidateQueries({
                queryKey: k
            }))
            toast({
                title: `Bookmark ${deleted ? "removed" : "added"}`,
                description: `File has been ${deleted ? "removed from" : "added to"} the ${ns} group`,
                duration: 2000,
            })
        }
        const onError = (error: any) => {
            toast({
                title: "Failed to update bookmark",
                description: error.message,
                variant: "destructive",
                duration: 2000,
            })
        }
        const params = {
            path: { namespace: ns, sha256: item.sha256 },
            query: dbs
        }
        if (deleted) {
            removeBookmarkMut.mutate({ params }, { onSuccess, onError })
        } else {
            addBookmarkMut.mutate({ params }, { onSuccess, onError })
        }
    }
    function addBookmark(group: string) {
        changeBookmarks(group, false)
    }
    async function removeBookmark(group: string) {
        changeBookmarks(group, true)
    }
    const currentBookmarks: string[] = fileBookmarks.data?.bookmarks.map(b => b.namespace).filter(b => b) as string[] || []

    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            onClickAdd()
        }
    }
    function onClickAdd() {
        if (inputValue === '') return
        if (!currentBookmarks.includes(inputValue)) {
            addBookmark(inputValue)
        }
        if (!mergedNamespaces.includes(inputValue)) {
            setBookmarkCustomNs(inputValue)
        }
        setInputValue('')
    }
    function onSelectOptions(option: string[]) {
        if (option === null) return
        const toAdd = option.filter(o => !currentBookmarks.includes(o))
        const toRemove = currentBookmarks.filter(o => !option.includes(o))
        toAdd.forEach(addBookmark)
        toRemove.forEach(removeBookmark)
    }

    return (
        <FilterContainer
            label={<span>Set Bookmarks</span>}
            description={<span>Add or remove this file from bookmark groups</span>}
            storageKey="file-bookmarks-open"
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                <Input
                    className="ml-1"
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a group name and press Enter to add" />
                <Button title="Add new group" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={mergedNamespaces.map((ns) => ({ value: ns, label: ns })) || []}
                    currentValues={currentBookmarks}
                    onSelectionChange={onSelectOptions}
                    placeholder="Not Bookmarked"
                    maxDisplayed={4}
                />
            </div>
        </FilterContainer>
    )
}