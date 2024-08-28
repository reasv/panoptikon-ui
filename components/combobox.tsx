"use client"

import * as React from "react"

import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
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

export function ComboBoxResponsive({
    options,
    currentValue,
    onChangeValue,
    resetValue,
    placeholder,
}: {
    options: Option[]
    currentValue: string | null,
    resetValue?: string,
    onChangeValue: (value: string | null) => void
    placeholder: string
}) {
    const [open, setOpen] = React.useState(false)
    const isDesktop = useMediaQuery("(min-width: 1024px)")
    const optionsMap = new Map(options.map((option) => [option.value, option]))
    const buttonLabel = currentValue ? (optionsMap.get(currentValue)?.label || placeholder) : placeholder
    if (isDesktop) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className=" justify-start">
                        {buttonLabel}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                    <OptionList resetValue={resetValue} currentValue={currentValue} options={options} setOpen={setOpen} onChangeValue={onChangeValue} />
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
                    <OptionList resetValue={resetValue} currentValue={currentValue} options={options} setOpen={setOpen} onChangeValue={onChangeValue} />
                </div>
            </DrawerContent>
        </Drawer>
    )
}

function OptionList({
    currentValue,
    resetValue,
    setOpen,
    onChangeValue,
    options,
}: {
    resetValue?: string,
    setOpen: (open: boolean) => void
    onChangeValue: (value: string | null) => void,
    options: Option[],
    currentValue: string | null
}) {
    function isSelected(value: string) {
        if (resetValue && value === resetValue) {
            return currentValue === null
        }
        return value === currentValue
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
                                onChangeValue(value === resetValue ? null : value)
                                setOpen(false)
                            }}
                        >
                            <Check
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    isSelected(option.value) ? "opacity-100" : "opacity-0"
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