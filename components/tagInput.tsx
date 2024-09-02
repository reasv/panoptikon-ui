"use client"
import { Input } from "@/components/ui/input"
import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "@/lib/utils"
import { useMemo, useState } from "react"
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

export function SearchBar({
    value,
    onChange,
    placeholder,
    inputClassName,
    popoverClassName
}: {
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    inputClassName?: string
    popoverClassName?: string
}) {
    const dbs = useSelectedDBs()[0]
    const currentTag = useMemo(() => {
        return getCurrentTag(value);
    }, [value])

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
        onChange(newString);
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
                addTag(value, data.tags[selectedIndex][1]);
                setFocus(false);
            }
        }
    };
    const onTextInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFocus(true);
    }
    const onTextInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const match_string = e.target.value
        onChange(match_string)
    }
    return (
        <Popover open={focus} onOpenChange={(open) => setFocus(open)}>
            <PopoverTrigger asChild>
                <Input
                    type="text"
                    placeholder={placeholder}
                    value={value}
                    onChange={onTextInputChange}
                    onFocus={() => setFocus(true)}
                    onBlur={() => setFocus(false)}
                    onClick={() => setFocus(true)}
                    onInput={onTextInput}
                    onKeyDown={handleKeyDown}
                    className={cn("flex-grow", inputClassName)}
                />
            </PopoverTrigger>
            <PopoverContent className={cn("w-[200px] p-0", popoverClassName)} align="start">
                <div
                    className={cn("p-2 cursor-pointer hover:bg-accent")}>
                    <span>{currentTag ? `Searching: ${currentTag}...` : "No Tag Detected"}</span>
                </div>
                {
                    data && data.tags.map((tag, index) => (
                        <div
                            onClick={() =>
                                addTag(value, tag[1])
                            }
                            className={cn("p-2 cursor-pointer hover:bg-accent",
                                index === selectedIndex && "bg-accent text-white")}>
                            <span>{tag[1]}</span>
                        </div>
                    ))
                }
            </PopoverContent>
        </Popover>
    )
}