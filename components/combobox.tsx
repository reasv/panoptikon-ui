"use client"

import * as React from "react"

import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
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

export type Option = {
    value: string
    label: string
}

export function ComboBoxResponsive({
    options,
    currentOption,
    onSelectOption,
    placeholder,
}: {
    options: Option[]
    currentOption: Option | null,
    onSelectOption: (option: Option | null) => void
    placeholder: string
}) {
    const [open, setOpen] = React.useState(false)
    const isDesktop = useMediaQuery("(min-width: 768px)")

    if (isDesktop) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className=" justify-start">
                        {currentOption ? <>{currentOption.label}</> : <>{placeholder}</>}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                    <OptionList options={options} setOpen={setOpen} setSelectedOption={onSelectOption} />
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <Button variant="outline" className="w-[150px] justify-start">
                    {currentOption ? <>{currentOption.label}</> : <>{placeholder}</>}
                </Button>
            </DrawerTrigger>
            <DrawerContent>
                <div className="mt-4 border-t">
                    <OptionList options={options} setOpen={setOpen} setSelectedOption={onSelectOption} />
                </div>
            </DrawerContent>
        </Drawer>
    )
}

function OptionList({
    setOpen,
    setSelectedOption,
    options,
}: {
    setOpen: (open: boolean) => void
    setSelectedOption: (option: Option | null) => void,
    options: Option[]
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
                                setSelectedOption(
                                    options.find((priority) => priority.value === value) || null
                                )
                                setOpen(false)
                            }}
                        >
                            {option.label}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    )
}