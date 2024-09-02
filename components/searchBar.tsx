"use client"
import { Input } from "@/components/ui/input"
import { useSearchQuery } from "@/lib/state/zust"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo, useState } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"
import { PLACEHOLDERS } from "@/lib/placeholders"
import { ClearSearch } from "./ClearSearch"
import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "@/lib/utils"
function getCurrentTag(inputString: string): string | null {
    // Handle the case where the input is empty or ends with a space or comma
    if (!inputString || inputString.endsWith(" ") || inputString.endsWith(",") || inputString.endsWith('"')) {
        return null;
    }

    // Find the position of the last space or comma
    const lastDelimiterIndex = Math.max(inputString.lastIndexOf(" "), inputString.lastIndexOf(","), inputString.lastIndexOf('"'));

    // Extract the current tag based on the last delimiter position
    const currentTag = inputString.slice(lastDelimiterIndex + 1);

    // If the current tag contains any space or comma (which shouldn't happen but let's be safe), return null
    if (currentTag.includes(" ") || currentTag.includes(",")) {
        return null;
    }
    // Return the current tag
    return currentTag;
}

function replaceCurrentTag(inputString: string, newTag: string): string {
    // Get the current tag using the previous function
    const currentTag = getCurrentTag(inputString);

    // If there's no current tag, return the input string as is
    if (currentTag === null) {
        return inputString;
    }

    // Find the position of the last delimiter (space or comma) before the current tag
    const lastDelimiterIndex = Math.max(inputString.lastIndexOf(" "), inputString.lastIndexOf(","));

    // Extract the part of the string before the current tag
    const stringBeforeTag = inputString.slice(0, lastDelimiterIndex + 1);

    // Return the combined string: before the tag + new tag
    return stringBeforeTag + newTag;
}

export function SearchBar() {
    const setAnyTextQuery = useSearchQuery((state) => state.setAnyTextQuery)
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)
    const setEnabled = useSearchQuery((state) => state.setEnableSearch)
    const rawFts5Match = useSearchQuery((state) => state.any_text.raw_fts5_match)
    const syntaxChecker = useSQLite(rawFts5Match)
    const checkInput = (query: string, fts5Enabled: boolean) => {
        if (query.length === 0) {
            setEnabled(true)
            return
        }
        let error = false
        if (fts5Enabled) {
            const valid = syntaxChecker.executeQuery(query)
            if (!valid) {
                setEnabled(false)
                error = true
            }
        }
        if (!error) {
            setEnabled(true)
        }
    }
    useEffect(() => {
        checkInput(anyTextQuery, rawFts5Match)
    }, [rawFts5Match])

    const onFTS5Enable = (enabled: boolean) => {
        checkInput(anyTextQuery, enabled)
    }

    const onTextInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const match_string = e.target.value
        checkInput(match_string, rawFts5Match)
        // Trigram search requires at least 3 characters
        if (match_string.length > 0 && match_string.length < 3) {
            setEnabled(false)
        }
        setAnyTextQuery(match_string)
    }

    const placeholder = useMemo(() => {
        const currentMinute = new Date().getMinutes();
        return PLACEHOLDERS[currentMinute % PLACEHOLDERS.length];
    }, [PLACEHOLDERS]);
    const dbs = useSelectedDBs()[0]
    const currentTag = useMemo(() => {
        return getCurrentTag(anyTextQuery);
    }, [anyTextQuery])
    const { data } = $api.useQuery("get", "/api/search/tags", {
        params: {
            query: {
                ...dbs,
                limit: 10,
                name: currentTag || "",
            },
        }
    }, {
        enabled: !!currentTag
    })



    const [focus, setFocus] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(0);

    const addTag = (currentString: string, tag: string) => {
        const newString = replaceCurrentTag(currentString, tag);
        setAnyTextQuery(newString);
    }

    const handleKeyDown = (e:
        React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (data && data.tags.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prevIndex) => (prevIndex + 1) % data.tags.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prevIndex) => (prevIndex - 1 + data.tags.length) % data.tags.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                addTag(anyTextQuery, data.tags[selectedIndex][1]);
                setFocus(false);
            }
        }
    };
    const onTextInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFocus(true);
    }
    return (
        <>
            <div className="relative w-full">
                <Popover open={focus} onOpenChange={(open) => setFocus(open)}>
                    <PopoverTrigger asChild>
                        <Input
                            type="text"
                            placeholder={placeholder}
                            value={anyTextQuery}
                            onChange={onTextInputChange}
                            onFocus={() => setFocus(true)}
                            onBlur={() => setFocus(false)}
                            onClick={() => setFocus(true)}
                            onInput={onTextInput}
                            onKeyDown={handleKeyDown}
                            className="flex-grow"
                        />
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0" align="start">
                        <div
                            className={cn("p-2 cursor-pointer hover:bg-accent")}>
                            <span>{`Searching: ${currentTag}...` || "No Tag Detected"}</span>
                        </div>
                        {
                            data && data.tags.map((tag, index) => (
                                <div
                                    onClick={() =>
                                        addTag(anyTextQuery, tag[1])
                                    }
                                    className={cn("p-2 cursor-pointer hover:bg-accent",
                                        index === selectedIndex && "bg-accent text-white")}>
                                    <span>{tag[1]}</span>
                                </div>
                            ))
                        }
                    </PopoverContent>
                </Popover>
                {syntaxChecker.error && anyTextQuery && rawFts5Match && (
                    <div className="absolute left-0 mt-2 bg-red-500 text-white text-sm p-2 rounded-md shadow-md">
                        {syntaxChecker.error}
                    </div>
                )}
            </div >
            <ClearSearch />
            <Fts5ToggleButton onFTS5Enable={onFTS5Enable} />
        </>
    )
}