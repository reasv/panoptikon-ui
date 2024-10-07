import { useMemo, useState } from "react"
import { useATSemanticImage, useATSemanticText, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { MultiBoxResponsive } from "./multiCombobox"
import { GlassWater, LoaderCircle, ScanSearch } from "lucide-react"
import { Toggle } from "./ui/toggle"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"

export function SearchTypeSelection() {
    const [options, setOptions] = useQueryOptions()
    const dbs = useSelectedDBs()[0]
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const [iembFilter, setIembFilter] = useATSemanticImage()
    const iembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "clip")
            .map((setter) => setter[1]) || []
    ]
    const [tembFilter, setTembFilter] = useATSemanticText()
    const tembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "text-embedding")
            .map((setter) => setter[1]) || []
    ]
    const onSelectionChange = (selectedOptions: string[]) => {

        if (selectedOptions.includes("iemb")) {
            if (
                iembFilter.model.length === 0
                && iembModels.length > 0
            ) {
                setIembFilter({
                    model: iembModels[0]
                })
            }
        }
        if (selectedOptions.includes("temb")) {
            if (
                tembFilter.model.length === 0
                && tembModels.length > 0
            ) {
                setTembFilter({
                    model: tembModels[0]
                })
            }
        }
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