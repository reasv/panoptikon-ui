import { useMemo, useState } from "react"
import { useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { MultiBoxResponsive } from "./multiCombobox"
import { GlassWater, LoaderCircle, MSquare, ScanSearch } from "lucide-react"
import { Toggle } from "./ui/toggle"

export function SearchTypeSelection() {
    const [options, setOptions] = useQueryOptions()

    const onSelectionChange = (selectedOptions: string[]) => {
        setOptions({
            at_e_path: selectedOptions.includes("path"),
            at_e_txt: selectedOptions.includes("fts"),
            at_e_si: selectedOptions.includes("iemb"),
            at_e_st: selectedOptions.includes("temb"),
        })
    }
    const [iembLoading, setIembLoading] = useState(false)
    const [tembLoading, setTembLoading] = useState(false)
    const allOptions = [
        {
            label: "File Path",
            value: "path",
        },
        {
            label: "Full Text",
            value: "fts",
        },
        {
            label: "Semantic Image Search",
            value: "iemb",
            icon: iembLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
        },
        {
            label: "Semantic Text Search",
            value: "temb",
            icon: tembLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
        },
    ]
    const selectedOptions = useMemo(() => {
        let selected = []
        if (options.at_e_path) {
            selected.push("path")
        }
        if (options.at_e_txt) {
            selected.push("fts")
        }
        if (options.at_e_si) {
            selected.push("iemb")
        }
        if (options.at_e_st) {
            selected.push("temb")
        }
        return selected
    }, [options])
    const [open, setOpen] = useState(false)
    return <MultiBoxResponsive
        options={allOptions}
        currentValues={selectedOptions}
        onSelectionChange={onSelectionChange}
        placeholder="Select an option"
        maxDisplayed={1}
        isOpen={open}
        onOpenChange={setOpen}
        button={
            <Toggle
                pressed={true}
                title={"Toggle search types"}
                aria-label="Toggle search types">
                <ScanSearch className="h-4 w-4" />
            </Toggle>
        }
    />
}