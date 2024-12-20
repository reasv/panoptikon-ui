"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import { Check, Delete } from "lucide-react"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Drawer,
    DrawerContent,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { ScrollBar } from "./ui/scroll-area"

export type Option = {
    value: string
    label: string
    removable?: boolean
    icon?: React.ReactNode
}

export function MultiBoxResponsive({
    options,
    resetValue,
    currentValues,
    onSelectionChange,
    maxDisplayed,
    placeholder,
    popoverClassName,
    buttonClassName,
    onRemoveOption,
    button,
    isOpen,
    onOpenChange,
    forceDrawer,
    omitWrapper,
    omitSearchBar,
}: {
    options: Option[],
    resetValue?: string,
    currentValues: string[],
    onSelectionChange: (values: string[]) => void
    placeholder: string,
    maxDisplayed: number
    popoverClassName?: string
    buttonClassName?: string
    onRemoveOption?: (value: string) => void
    button?: React.ReactNode
    isOpen?: boolean
    onOpenChange?: (isOpen: boolean) => void
    forceDrawer?: boolean
    omitWrapper?: boolean
    omitSearchBar?: boolean
}) {
    const [open, setOpen] = React.useState(false)
    const isDesktop = useMediaQuery("(min-width: 1024px)")
    const optionsMap = new Map(options.map((option) => [option.value, option]))

    let buttonLabel = placeholder
    if (currentValues.length === 0) {
        buttonLabel = resetValue ? (optionsMap.get(resetValue)?.label || resetValue) : placeholder
    } else if (currentValues.length === 1) {
        buttonLabel = optionsMap.get(currentValues[0])?.label || currentValues[0]
    } else if (currentValues.length <= maxDisplayed) {
        buttonLabel = currentValues.map((v) => optionsMap.get(v)?.label || v).join(", ")
    } else if (maxDisplayed === 1) {
        buttonLabel = `${optionsMap.get(currentValues[0])?.label || currentValues[0]}, ...`
    } else {
        // Show the first maxDisplayed values
        buttonLabel = currentValues.slice(0, maxDisplayed).map((v) => optionsMap.get(v)?.label || v).join(", ") + ", ..."
    }

    function onOptionToggle(value: string) {
        if (resetValue && value === resetValue) {
            onSelectionChange([])
            return
        }
        if (currentValues.includes(value)) {
            onSelectionChange(currentValues.filter((v) => v !== value))
        } else {
            onSelectionChange([...currentValues, value])
        }
    }

    if (omitWrapper) {
        return (
            <OptionList
                removeOption={onRemoveOption}
                defaultValue={resetValue}
                selectedValues={currentValues}
                options={options}
                toggleValue={onOptionToggle}
                omitSearchBar={omitSearchBar}
            />
        )
    }

    if (isDesktop && !forceDrawer) {
        return (
            <Popover
                open={isOpen !== undefined ? isOpen : open}
                onOpenChange={onOpenChange !== undefined ? onOpenChange : setOpen}
            >
                <PopoverTrigger asChild>
                    {button ||
                        <Button variant="outline" className={cn("justify-start max-w-[270px]", buttonClassName)}>
                            <span className="truncate">{buttonLabel}</span>
                        </Button>
                    }
                </PopoverTrigger>
                <PopoverContent
                    className={cn("max-w-[50vw] w-full p-0", popoverClassName)}
                    align="start">
                    <OptionList
                        removeOption={onRemoveOption}
                        defaultValue={resetValue}
                        selectedValues={currentValues}
                        options={options}
                        toggleValue={onOptionToggle}
                        omitSearchBar={omitSearchBar}
                    />
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Drawer
            open={isOpen !== undefined ? isOpen : open}
            onOpenChange={onOpenChange !== undefined ? onOpenChange : setOpen}
        >
            <DrawerTrigger asChild>
                {button ||
                    <Button variant="outline" className={cn("justify-start max-w-[300px]", buttonClassName)}>
                        <span className="truncate">{buttonLabel}</span>
                    </Button>
                }
            </DrawerTrigger>
            <DrawerTitle title="Options" />
            <DrawerContent>
                <div className="mt-4 border-t">
                    <OptionList
                        removeOption={onRemoveOption}
                        defaultValue={resetValue}
                        selectedValues={currentValues}
                        options={options}
                        toggleValue={onOptionToggle}
                        omitSearchBar={omitSearchBar}
                    />
                </div>
            </DrawerContent>
        </Drawer>
    )
}
function OptionList({
    selectedValues,
    toggleValue,
    options,
    defaultValue,
    removeOption,
    omitSearchBar,
}: {
    toggleValue: (value: string) => void,
    options: Option[],
    selectedValues: string[],
    defaultValue?: string
    removeOption?: (value: string) => void
    omitSearchBar?: boolean
}) {
    const isSelected = (value: string) => {
        if (selectedValues.length === 0 && defaultValue) {
            return value === defaultValue
        }
        return selectedValues.includes(value)
    }
    return (
        <Command>
            {!omitSearchBar && <CommandInput placeholder="Filter..." />}
            <CommandList>
                <ScrollAreaPrimitive.Root type="auto" className="relative">
                    <ScrollAreaPrimitive.Viewport
                        onWheel={(e) => {
                            e.stopPropagation()
                        }}
                        className="max-h-[300px]">
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    title={option.label}
                                    key={option.value}
                                    value={option.value}
                                    onSelect={(value) => {
                                        toggleValue(value)
                                    }}
                                >
                                    {option.icon ||
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                isSelected(option.value) ? "opacity-100" : "opacity-0"
                                            )}
                                        />}
                                    {option.removable && removeOption && (
                                        <Button className="ml-1 mr-4 h-5 w-5 hover:outline" onClick={(e) => {
                                            e.stopPropagation()
                                            removeOption(option.value)
                                        }} title="Remove custom value" variant="ghost" size="icon">
                                            <Delete className="h-4 w-4 rotate-180" />
                                        </Button>)}
                                    <span className="truncate">{option.label}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </ScrollAreaPrimitive.Viewport>
                    <ScrollBar />
                    <ScrollAreaPrimitive.Corner />
                </ScrollAreaPrimitive.Root>
            </CommandList>
        </Command>
    )
}