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

    // Return the combined string: before the tag + new tag + space
    return stringBeforeTag + newTag + " ";
}

export function TagCompletionInput({
    value,
    onChange,
    placeholder,
    inputClassName,
    popoverClassName,
    onSubmit,
}: {
    value: string,
    onChange: (value: string) => void,
    onSubmit?: () => void,
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
                // Ensure the selectedIndex is within bounds before accessing the array
                const validIndex = selectedIndex % data.tags.length;
                const selectedTag = data.tags[validIndex][1];
                addTag(value, selectedTag);
                setSelectedIndex(0);
            }
        } else {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (onSubmit) {
                    onSubmit()
                }
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
    const validIndex = data ? selectedIndex % data.tags.length : 0
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
            <PopoverContent
                onOpenAutoFocus={(e) => e.preventDefault()}
                className={cn("w-[200px] p-0", popoverClassName)} align="start">
                {value.length > 0 &&
                    <div
                        className={cn("p-1 text-sm cursor-pointer hover:bg-accent")}>
                        <span>{currentTag ? `Results for '${currentTag}'` : "Start typing a tag..."}</span>
                    </div>
                }
                {
                    data && data.tags.map((tag, index) => (
                        <div
                            key={`${tag}`}
                            onClick={() =>
                                addTag(value, tag[1])
                            }
                            className={cn("p-2 cursor-pointer hover:bg-accent",
                                index === validIndex && "bg-accent text-white")}>
                            <span>{tag[1]}</span>
                        </div>
                    ))
                }
            </PopoverContent>
        </Popover>
    )
}


import {
    CommandGroup,
    CommandItem,
    CommandList,
    CommandInput,
} from "./ui/commandTrim"
import { Command as CommandPrimitive } from "cmdk"
import { useRef, useCallback, type KeyboardEvent } from "react"

export type Option = Record<"value" | "label", string> & Record<string, string>

type AutoCompleteProps = {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
    onSubmit?: () => void
    inputClassName?: string
    popoverClassName?: string
}

export const TagAutoComplete = ({
    placeholder,
    value,
    onChange,
    disabled,
    onSubmit,
    inputClassName,
    popoverClassName,
}: AutoCompleteProps) => {
    const inputRef = useRef<HTMLInputElement>(null)

    const [isOpen, setOpen] = useState(false)
    const dbs = useSelectedDBs()[0]

    const currentTag = useMemo(() => {
        return getCurrentTag(value);
    }, [value])

    const { data, isLoading } = $api.useQuery("get", "/api/search/tags", {
        params: {
            query: {
                ...dbs,
                limit: 9,
                name: currentTag || "",
            },
        }
    }, {
        enabled: !!currentTag
    })
    const addTag = (currentString: string, tag: string) => {
        const newString = replaceCurrentTag(currentString, tag);
        onChange(newString);
    }

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            const input = inputRef.current
            if (!input) {
                return
            }

            // Keep the options displayed when the user is typing
            if (!isOpen) {
                setOpen(true)
            }
            if (!data || data.tags.length === 0) {
                if (event.key === "Enter") {
                    event.preventDefault()
                    if (onSubmit) {
                        onSubmit()
                    }
                }
            }

            if (event.key === "Escape") {
                input.blur()
            }
        },
        [isOpen, onChange, value, data],
    )

    const handleBlur = useCallback(() => {
        setOpen(false)
    }, [])

    const handleSelectOption = useCallback(
        (selectedTag: string) => {
            addTag(value, selectedTag);

            // // This is a hack to prevent the input from being focused after the user selects an option
            // // We can call this hack: "The next tick"s
            // setTimeout(() => {
            //     inputRef?.current?.blur()
            // }, 0)
        },
        [isOpen, onChange, value, data],
    )
    const emptyMessage = (data && data.tags.length === 0) ? "No tags found" : "Start typing a tag..."
    return (
        <CommandPrimitive loop shouldFilter={false} onKeyDown={handleKeyDown}>
            <div>
                <CommandInput
                    ref={inputRef}
                    value={value}
                    onValueChange={onChange}
                    onBlur={handleBlur}
                    onFocus={() => setOpen(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={cn(
                        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", "flex-grow", inputClassName)}
                />
            </div>
            <div className="relative mt-1">
                <div
                    className={cn(
                        "animate-in fade-in-0 zoom-in-95",
                        "absolute top-1 z-10 max-w-full outline-none rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
                        isOpen ? "block" : "hidden",
                        popoverClassName
                    )}
                >
                    <CommandList className="">
                        {isLoading ? (
                            <CommandPrimitive.Loading>
                                <div className="select-none text-center text-sm">
                                    {"Loading..."}
                                </div>
                            </CommandPrimitive.Loading>
                        ) : null}
                        {data && !isLoading ? (
                            <CommandGroup>
                                {data.tags.map((tag, index) => {
                                    return (
                                        <CommandItem
                                            key={tag[1]}
                                            value={tag[1]}
                                            onMouseDown={(event) => {
                                                event.preventDefault()
                                                event.stopPropagation()
                                            }}
                                            onSelect={() => handleSelectOption(tag[1])}
                                            className={cn(
                                                "flex w-full items-center gap-2",
                                            )}
                                        >
                                            {tag[1]}
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        ) : null}
                        {!isLoading ? (
                            <CommandPrimitive.Empty className="select-none text-center text-sm p-1">
                                {emptyMessage}
                            </CommandPrimitive.Empty>
                        ) : null}
                    </CommandList>
                </div>
            </div>
        </CommandPrimitive>
    )
}