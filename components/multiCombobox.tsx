"use client"

import * as React from "react"

import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import { Check, ChevronsUpDown } from "lucide-react"
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
}

export function MultiBoxResponsive({
    options,
    resetOption,
    currentOptions,
    onSelectionChange,
    maxDisplayed,
    placeholder,
}: {
    options: Option[],
    resetOption: Option,
    currentOptions: Option[],
    onSelectionChange: (options: Option[]) => void
    placeholder: string,
    maxDisplayed: number
}) {
    const [open, setOpen] = React.useState(false)
    const isDesktop = useMediaQuery("(min-width: 768px)")
    let buttonLabel = placeholder
    if (currentOptions.length === 0) {
        buttonLabel = placeholder
    } else if (currentOptions.length === 1) {
        buttonLabel = currentOptions[0].label
    } else if (currentOptions.length <= maxDisplayed) {
        buttonLabel = currentOptions.map((option) => option.label).join(", ")
    } else {
        buttonLabel = `${currentOptions[0].label},...`
    }

    function onOptionToggle(option: Option | null) {
        if (option === null) {
            onSelectionChange([resetOption])
            return
        }
        if (option.value === resetOption.value) {
            onSelectionChange([resetOption])
        }
        if (currentOptions.some(o => o.value === option.value)) {
            onSelectionChange(currentOptions.filter((o) => o.value !== option.value))
        } else {
            onSelectionChange([...currentOptions, option])
        }
    }


    if (isDesktop) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className=" justify-start">
                        {buttonLabel}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                    <OptionList selectedOptions={currentOptions} options={options} toggleSelectedOption={onOptionToggle} />
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <Button variant="outline" className="w-[150px] justify-start">
                    {buttonLabel}
                </Button>
            </DrawerTrigger>
            <DrawerContent>
                <div className="mt-4 border-t">
                    <OptionList selectedOptions={currentOptions} options={options} toggleSelectedOption={onOptionToggle} />
                </div>
            </DrawerContent>
        </Drawer>
    )
}

function OptionList({
    selectedOptions,
    toggleSelectedOption,
    options,
}: {
    toggleSelectedOption: (option: Option | null) => void,
    options: Option[],
    selectedOptions: Option[]
}) {
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
                                toggleSelectedOption(
                                    options.find((priority) => priority.value === value) || null
                                )
                            }}
                        >
                            <Check
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedOptions.find((priority) => priority.value === option.value) ? "opacity-100" : "opacity-0"
                                )}
                            />
                            {option.label}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    )
}