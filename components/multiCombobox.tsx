"use client"

import * as React from "react"

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
    DrawerTrigger,
} from "@/components/ui/drawer"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type Option = {
    value: string
    label: string
    removable?: boolean
}

export function MultiBoxResponsive({
    options,
    resetValue,
    currentValues,
    onSelectionChange,
    maxDisplayed,
    placeholder,
    popoverClassName,
    onRemoveOption,
}: {
    options: Option[],
    resetValue?: string,
    currentValues: string[],
    onSelectionChange: (values: string[]) => void
    placeholder: string,
    maxDisplayed: number
    popoverClassName?: string
    onRemoveOption?: (value: string) => void
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

    if (isDesktop) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start max-w-[270px]">
                        <span className="truncate">{buttonLabel}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className={cn("w-[200px] p-0", popoverClassName)} align="start">
                    <OptionList removeOption={onRemoveOption} defaultValue={resetValue} selectedValues={currentValues} options={options} toggleValue={onOptionToggle} />
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <Button variant="outline" className="justify-start max-w-[300px]">
                    <span className="truncate">{buttonLabel}</span>
                </Button>
            </DrawerTrigger>
            <DrawerContent>
                <div className="mt-4 border-t">
                    <OptionList removeOption={onRemoveOption} defaultValue={resetValue} selectedValues={currentValues} options={options} toggleValue={onOptionToggle} />
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
}: {
    toggleValue: (value: string) => void,
    options: Option[],
    selectedValues: string[],
    defaultValue?: string
    removeOption?: (value: string) => void
}) {
    const isSelected = (value: string) => {
        if (selectedValues.length === 0 && defaultValue) {
            return value === defaultValue
        }
        return selectedValues.includes(value)
    }
    return (
        <Command>
            <CommandInput placeholder="Filter..." />
            <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                    {options.map((option) => (
                        <CommandItem
                            key={option.value}
                            value={option.value}
                            onSelect={(value) => {
                                toggleValue(value)
                            }}
                        >
                            <Check
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    isSelected(option.value) ? "opacity-100" : "opacity-0"
                                )}
                            />
                            {option.removable && removeOption && (
                                <Button className="ml-1 mr-4 h-5 w-5 hover:outline" onClick={(e) => {
                                    e.stopPropagation()
                                    removeOption(option.value)
                                }} title="Remove custom value" variant="ghost" size="icon">
                                    <Delete className="h-4 w-4 rotate-180" />
                                </Button>)}
                            {option.label}

                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    )
}