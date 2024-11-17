"use client"
import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { cn } from "@/lib/utils"
import { useMemo, useState } from "react"
import {
    CommandGroup,
    CommandItem,
    CommandList,
    CommandInput,
} from "./ui/commandTrim"
import { Command as CommandPrimitive } from "cmdk"
import { useRef, useCallback, type KeyboardEvent } from "react"

export const TAG_PREFIXES = ["-", "*", "~"]

function getCurrentTag(inputString: string, includePrefix: boolean = false): string | null {
    // Handle the case where the input is empty or ends with a space or comma
    if (!inputString || inputString.endsWith(" ") || inputString.endsWith(",") || inputString.endsWith('"')) {
        return null
    }
    // If the input string ends with a tag prefix, return null
    if (TAG_PREFIXES.some((prefix) => inputString.endsWith(prefix))) {
        return null
    }

    // Find the position of the last space or comma
    const lastDelimiterIndex = Math.max(inputString.lastIndexOf(" "), inputString.lastIndexOf(","), inputString.lastIndexOf('"'))

    // Extract the current tag based on the last delimiter position
    const currentTag = inputString.slice(lastDelimiterIndex + 1)

    // If the current tag contains any space or comma (which shouldn't happen but let's be safe), return null
    if (currentTag.includes(" ") || currentTag.includes(",")) {
        return null
    }

    if (!includePrefix && TAG_PREFIXES.some((prefix) => currentTag.startsWith(prefix))) {
        return currentTag.slice(1)
    }
    // Return the current tag
    return currentTag
}

function replaceCurrentTag(inputString: string, newTag: string): string {
    // Get the current tag using the previous function
    const currentTag = getCurrentTag(inputString, true)

    // If there's no current tag, return the input string as is
    if (currentTag === null) {
        return inputString
    }

    // Find the position of the last delimiter (space or comma) before the current tag
    const lastDelimiterIndex = Math.max(inputString.lastIndexOf(" "), inputString.lastIndexOf(","))

    // Extract the part of the string before the current tag
    const stringBeforeTag = inputString.slice(0, lastDelimiterIndex + 1)

    // If the current tag starts with a tag prefix, add the prefix to the new tag
    if (TAG_PREFIXES.some((prefix) => currentTag.startsWith(prefix))) {
        newTag = currentTag[0] + newTag
    }

    // Return the combined string: before the tag + new tag + space
    return stringBeforeTag + newTag + " "
}

export type Option = Record<"value" | "label", string> & Record<string, string>

type AutoCompleteProps = {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
    onSubmit?: () => void
    inputClassName?: string
    popoverClassName?: string
    className?: string
}

export const TagAutoComplete = ({
    placeholder,
    value,
    onChange,
    disabled,
    onSubmit,
    inputClassName,
    popoverClassName,
    className,
}: AutoCompleteProps) => {
    const inputRef = useRef<HTMLInputElement>(null)

    const [isOpen, setOpen] = useState(false)
    const dbs = useSelectedDBs()[0]

    const currentTag = useMemo(() => {
        return getCurrentTag(value)
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
        const newString = replaceCurrentTag(currentString, tag)
        onChange(newString)
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
            addTag(value, selectedTag)

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
        <CommandPrimitive
            className={className}
            loop
            shouldFilter={false}
            onKeyDown={handleKeyDown}
        >
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
                                {data.tags.map((tag) =>
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
                                        {tag[1]} <span className="text-muted-foreground text-sm">({tag[2]})</span>
                                    </CommandItem>

                                )}
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
