import { useMemo, useState } from "react"
import { useATSemanticAudio, useATSemanticImage, useATSemanticText, useEmbedArgs, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { MultiBoxResponsive } from "./multiCombobox"
import { LoaderCircle, ScanSearch, ArrowRight } from "lucide-react"
import { Toggle } from "./ui/toggle"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"
import { useEnableEmbeddingSearch } from "@/lib/enableEmbeddingSearch"
export function splitByFirstSlash(input: string): [string, string] {
    const index = input.indexOf('/');
    if (index === -1) {
        return [input, ''];
    }

    const part1 = input.substring(0, index);
    const part2 = input.substring(index + 1);

    return [part1, part2];
}
export function SearchTypeSelection() {
    const [options, setOptions] = useQueryOptions()
    const [embedArgs, setEmbedArgs] = useEmbedArgs()
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
            .filter((setter) => !setter[1].startsWith("clap"))
            .map((setter) => setter[1]) || []
    ]
    const [aembFilter, setAembFilter] = useATSemanticAudio()
    const aembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "clip")
            .filter((setter) => setter[1].startsWith("clap"))
            .map((setter) => setter[1]) || []
    ]
    const [tembFilter, setTembFilter] = useATSemanticText()
    const tembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "text-embedding")
            .map((setter) => setter[1])
            .filter(setter => !setter.startsWith("tclip/")) || []
    ]
    const [onIembEnableChange, iembIsLoading] = useEnableEmbeddingSearch({
        type: "image",
        setEnable: (value: boolean) => setOptions({ at_e_si: value }),
        model: iembFilter.model,
        setModel: (value: string) => setIembFilter({ model: value }),
        models: iembModels
    })

    const [onAembEnableChange, aembIsLoading] = useEnableEmbeddingSearch({
        type: "audio",
        setEnable: (value: boolean) => setOptions({ at_e_sa: value }),
        model: aembFilter.model,
        setModel: (value: string) => setAembFilter({ model: value }),
        models: aembModels
    })

    const [onTembEnableChange, tembIsLoading] = useEnableEmbeddingSearch({
        type: "text",
        setEnable: (value: boolean) => setOptions({ at_e_st: value }),
        model: tembFilter.model,
        setModel: (value: string) => setTembFilter({ model: value }),
        models: tembModels
    })
    const onSelectionChange = (selectedOptions: string[]) => {
        if (selectedOptions.filter((option) => option === "tag_mode").length > 0) {
            setOptions({
                at_query: "",
                tag_mode: true,
                e_tags: true,
            })
            return
        }
        setOptions({
            at_e_path: selectedOptions.includes("path"),
            at_e_txt: selectedOptions.includes("fts"),
        })
        const tembEnabled = selectedOptions.includes("temb")
        const iembEnabled = selectedOptions.includes("iemb")
        const aembEnabled = selectedOptions.includes("aemb")
        // if the selected options are different from the current options, update the state
        if (tembEnabled !== options.at_e_st) {
            onTembEnableChange(tembEnabled)
        }
        if (iembEnabled !== options.at_e_si) {
            onIembEnableChange(iembEnabled)
        }
        if (aembEnabled !== options.at_e_sa) {
            onAembEnableChange(aembEnabled)
        }
    }
    const tagModels = data?.setters.filter((setter) => setter[0] === "tags").map((setter) => setter[1]) || []

    const allOptions = [
        {
            label: "File Path",
            value: "path",
            available: true,
        },
        {
            label: "Full Text",
            value: "fts",
            available: true,
        },
        {
            label: "Semantic Image Search",
            value: "iemb",
            icon: iembIsLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
            available: iembModels.length > 0,
        },
        {
            label: "Semantic Audio Search",
            value: "aemb",
            icon: aembIsLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
            available: aembModels.length > 0,
        },
        {
            label: "Semantic Text Search",
            value: "temb",
            icon: tembIsLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
            available: tembModels.length > 0,
        },
        {
            label: "Switch to Exact Tags",
            value: "tag_mode",
            // icon: <ArrowRight className="mr-2 h-4 w-4" />,
            available: tagModels.length > 0,
        },
    ]
    const availableOptions = allOptions.filter((option) => option.available).map((option) => ({ ...option, available: undefined }))

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
        if (options.at_e_sa) {
            selected.push("aemb")
        }
        return selected
    }, [options])
    const [open, setOpen] = useState(false)
    return <MultiBoxResponsive
        options={availableOptions}
        currentValues={selectedOptions}
        onSelectionChange={onSelectionChange}
        placeholder="Select an option"
        maxDisplayed={1}
        isOpen={open}
        onOpenChange={setOpen}
        omitSearchBar={true}
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