import { useDetailsPane } from "@/lib/state/zust"
import { FilterContainer } from "../base/FilterContainer"
import { components } from "@/lib/panoptikon"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/use-toast"
import { FileBookmarks } from "./FileBookmarks"
import { ItemFileDetails } from "./ItemFileDetails"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSelectedDBs } from "@/lib/state/database"
import { useMemo } from "react"

export function ItemDetails() {
    const selected = useItemSelection((state) => state.getSelected())
    return (
        <div className="mt-4">
            {selected && <ItemFileDetails item={selected} />}
            <ExtractedText item={selected} />
            <ItemTagDetails item={selected} />
            <ExtractedMetadata item={selected} />
            <ResetFilters />
            {selected && <FileBookmarks item={selected} />}
        </div>
    )
}

function ResetFilters() {
    const resetFilters = useDetailsPane((state) => state.resetFilters)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">Reset Filters</div>
                    <div className="text-gray-400">Reset all filters on file details</div>
                </div>
                <Button
                    title="Clear all detail filters"
                    variant="ghost"
                    size="icon"
                    onClick={() => resetFilters()}
                >
                    <Delete
                        className="h-4 w-4"
                    />
                </Button>
            </div>
        </div>
    )
}

function ExtractedText({
    item,
}: {
    item: SearchResult | null
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })

    const textSetters = ["*", ...data?.setters.filter((s) => s[0] === "text").map((s) => s[1]) || []]
    const setterOptions = textSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Text Sources" : setter }))
    const selectedSetters = useDetailsPane((state) => state.text_setters)
    const setSelectedSetters = useDetailsPane((state) => state.setTextSetters)

    const textLanguages = ["*", ...data?.text_stats.languages || []]
    const languageOptions = textLanguages.map((setter) => ({ value: setter, label: setter === "*" ? "All Languages" : setter }))
    const setSelectedLanguages = useDetailsPane((state) => state.setTextLanguages)
    const setMinConfidence = useDetailsPane((state) => state.setMinConfidence)
    const minConfidence = useDetailsPane((state) => state.text_min_confidence)
    const setMinLanguageConfidence = useDetailsPane((state) => state.setMinLanguageConfidence)
    const minLanguageConfidence = useDetailsPane((state) => state.min_language_confidence)
    const selectedLanguages = useDetailsPane((state) => state.text_languages)
    const maxTextLength = useDetailsPane((state) => state.text_max_length)
    const setMaxTextLength = useDetailsPane((state) => state.setTextMaxLength)
    return (
        <FilterContainer
            storageKey="extractedTextdetailOpen"
            label={<span>Extracted Text</span>}
            description={
                <span>Text extracted from this item</span>
            }
            unMountOnCollapse
        >
            <FilterContainer
                storageKey="extractedTextdetailFilterOpen"
                label={<span>Text Filters</span>}
                description={
                    <span>Filter the displayed text</span>
                }
            // defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={setterOptions}
                        currentValues={selectedSetters}
                        onSelectionChange={setSelectedSetters}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Confidence Threshold</span>}
                    confidence={minConfidence}
                    setConfidence={setMinConfidence}
                    description={<span>Minimum confidence for the extracted text</span>}
                />
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={languageOptions}
                        currentValues={selectedLanguages}
                        onSelectionChange={setSelectedLanguages}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Language Confidence Threshold</span>}
                    confidence={minLanguageConfidence}
                    setConfidence={setMinLanguageConfidence}
                    description={<span>Minimum confidence for language detection</span>}
                />
                <ConfidenceFilter
                    label={<span>Truncation Length</span>}
                    confidence={maxTextLength}
                    setConfidence={setMaxTextLength}
                    description={<span>Cut text off after n characters</span>}
                    min={0}
                    max={5000}
                    step={10}
                />
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <ExtractedTextList
                        item={item}
                        selectedSetters={selectedSetters}
                        selectedLanguages={selectedLanguages}
                        minConfidence={minConfidence}
                        minLanguageConfidence={minLanguageConfidence}
                        maxLength={maxTextLength}
                    />)}
            </div>
        </FilterContainer>
    )
}

function ExtractedTextList(
    {
        item,
        selectedSetters,
        selectedLanguages,
        minConfidence,
        minLanguageConfidence,
        maxLength
    }: {
        item: SearchResult,
        selectedSetters: string[],
        selectedLanguages: string[],
        minConfidence: number,
        minLanguageConfidence: number,
        maxLength: number
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/items/item/text", {
        params: {
            query: {
                setters: selectedSetters,
                truncate_length: maxLength ? maxLength : undefined,
                id: item.sha256,
                id_type: "sha256",
                ...dbs
            }
        }
    },
        {
            placeholderData: keepPreviousData
        }
    )
    const text = (
        data?.text
            .filter((t) => selectedLanguages.length == 0 || selectedLanguages.includes(t.language))
            .filter((t) => minConfidence > 0 ? (t.confidence || 0) >= minConfidence : true)
            .filter((t) => minLanguageConfidence > 0 ? (t.language_confidence || 0) >= minLanguageConfidence : true)
    ) || []
    return (
        <div className="mt-4">
            {text.map((t, i) => (
                <ExtractedTextCard key={`${t.setter_name}-${i}`} text={t} />
            ))}
        </div>
    )
}

function ExtractedTextCard(
    {
        text,
    }: {
        text: components["schemas"]["ExtractedText"]
    }
) {
    const truncatedCharNumber = text.length - text.text.length
    const omittedDisplay = truncatedCharNumber > 0 ? "... " + (`(${truncatedCharNumber} omitted)`) : ''
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{text.setter_name} <span className="text-gray-400"> {text.language}</span></div>
                    <div className="text-gray-400 p-1 select-text ">{text.text}<i>{omittedDisplay}</i></div>
                    <div className="text-gray-400 font-medium">Confidence: {text.confidence} (Language: {text.language_confidence})</div>
                </div>
            </div>
        </div>
    )
}

function ItemTagDetails({
    item,
}: {
    item: SearchResult | null
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })

    const tagSetters = ["*", ...data?.setters.filter((s) => s[0] === "tags").map((s) => s[1]) || []]
    const setterOptions = tagSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Tag Sources" : setter }))
    const selectedSetters = useDetailsPane((state) => state.tag_setters)
    const setSelectedSetters = useDetailsPane((state) => state.setTagSetters)

    const tagNamespaces = ["*", ...data?.tags.namespaces || []]
    const nsOptions = tagNamespaces.map((ns) => ({ value: ns, label: ns === "*" ? "All Namespaces" : ns }))
    const setSelectedNamespaces = useDetailsPane((state) => state.setTagNamespaces)
    const setMinConfidence = useDetailsPane((state) => state.setTagMinConfidence)
    const minConfidence = useDetailsPane((state) => state.tag_min_confidence)

    const selectedTagNs = useDetailsPane((state) => state.tag_namespaces)
    const maxTagsNsSetters = useDetailsPane((state) => state.tags_max_per_ns_setter)
    const setMaxTagsNsSetters = useDetailsPane((state) => state.setTagsMaxPerNsSetter)
    return (
        <FilterContainer
            storageKey="tagsDetailOpen"
            label={<span>Tags</span>}
            description={
                <span>Tags added to this item</span>
            }
            unMountOnCollapse
        >
            <FilterContainer
                storageKey="tagsDetailFilterOpen"
                label={<span>Tag Filters</span>}
                description={
                    <span>Filter the tags shown</span>
                }
            // defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={setterOptions}
                        currentValues={selectedSetters}
                        onSelectionChange={setSelectedSetters}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Confidence Threshold</span>}
                    confidence={minConfidence}
                    setConfidence={setMinConfidence}
                    description={<span>Minimum confidence for the tags to be displayed</span>}
                />
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={nsOptions}
                        currentValues={selectedTagNs}
                        onSelectionChange={setSelectedNamespaces}
                        placeholder="Select Namespaces"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Max Tags Per Namespace</span>}
                    confidence={maxTagsNsSetters}
                    setConfidence={setMaxTagsNsSetters}
                    description={<span>Cut off lower confidence tags beyond this limit</span>}
                    min={0}
                    max={100}
                    step={1}
                />
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <ItemTags
                        item={item}
                        namespaces={selectedTagNs}
                        setters={selectedSetters}
                        minConfidence={minConfidence}
                        maxTagsPerNsSetter={maxTagsNsSetters}
                    />)}
            </div>
        </FilterContainer>
    )
}

function ItemTags(
    {
        item,
        setters,
        namespaces,
        minConfidence,
        maxTagsPerNsSetter
    }: {
        item: SearchResult,
        setters: string[],
        namespaces: string[],
        minConfidence: number,
        maxTagsPerNsSetter: number
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/items/item/tags", {
        params: {
            query: {
                setters,
                namespaces,
                confidence_threshold: minConfidence,
                limit_per_namespace: maxTagsPerNsSetter,
                id: item.sha256,
                id_type: "sha256",
                ...dbs
            }
        }
    },
        {
            placeholderData: keepPreviousData
        }
    )
    const tags = data?.tags || []
    const mergedTags = mergeTags(tags)
    return (
        <div className="mt-4">
            {mergedTags.map(([namespace, tags]) => (
                <TagDisplay key={namespace} namespace={namespace} tags={tags.slice(0, maxTagsPerNsSetter)} />
            ))}
        </div>
    )
}
function mergeNs(tags: [string, string, number, string][]) {
    const namespaces: string[] = []
    const tagMap: { [key: string]: [string, number, string][] } = {}
    tags.forEach(([ns, tag, confidence, setter]) => {
        if (!tagMap[ns]) {
            tagMap[ns] = []
            namespaces.push(ns)
        }
        tagMap[ns].push([tag, confidence, setter])
    })
    const merges: [string, [string, number, string][]][] = []
    for (let namespace of namespaces) {
        merges.push([namespace, tagMap[namespace]])
    }
    return merges
}

function mergeSetters(tags: [string, number, string][]) {
    const tagMap: { [key: string]: number } = {}
    tags.forEach(([tag, confidence, setter]) => {
        if (!tagMap[tag]) {
            tagMap[tag] = confidence
        } else {
            tagMap[tag] = Math.max(tagMap[tag], confidence)
        }
    })
    return tagMap
}

function mergeTags(tags: [string, string, number, string][]) {
    const namespaces = mergeNs(tags)
    const merged: [string, [string, number][]][] = []
    for (let [ns, tags] of namespaces) {
        const mtags = mergeSetters(tags)
        const tags_arr: [string, number][] = Object.entries(mtags) as [string, number][];
        tags_arr.sort(([, value1], [, value2]) => value2 - value1);
        merged.push([ns, tags_arr])
    }
    return merged
}

function TagDisplay(
    {
        namespace,
        tags
    }: {
        namespace: string,
        tags: [string, number][]
    }
) {
    const { toast } = useToast()
    const handleClick = (tag: string) => {
        navigator.clipboard.writeText(tag)
            .then(() => {
                toast({
                    title: "Copied to clipboard",
                    description: `Tag ${tag} copied to clipboard`,
                    duration: 2000,
                })
            })
            .catch(err => {
                toast({
                    title: "Failed",
                    description: `Failed to copy tag ${tag} to clipboard`,
                    variant: "destructive",
                    duration: 2000,
                })
            });
    };
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="text-base font-medium">{namespace}</div>
            <div>
                {
                    tags.map(([tag, confidence]) => (
                        <TagLabel key={tag} tag={tag} onClick={handleClick} confidence={confidence} />
                    ))
                }
            </div>
        </div>
    )
}
function TagLabel({
    tag,
    confidence,
    onClick
}: {
    tag: string,
    confidence: number
    onClick: (tag: string) => void
}) {
    return (
        <div key={tag} className="text-gray-400 select-text p-1">
            <span
                className="cursor-pointer"
                onClick={() => onClick(tag)}
                title="Click to copy tag"
            >
                {tag} <i>({confidence.toFixed(2)})</i>
            </span>
            <div className="h-1"></div>
            <Progress className="h-1" value={confidence * 100} />
        </div>
    );
}

function ExtractedMetadata({
    item,
}: {
    item: SearchResult | null
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })

    const textSetters = ["*", ...data?.setters.filter((s) => s[0] === "text").map((s) => s[1]) || []]
    const setterOptions = textSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Text Sources" : setter }))
    const selectedSetters = useDetailsPane((state) => state.metadata_setters)
    const setSelectedSetters = useDetailsPane((state) => state.setMetadataSetters)
    const setMinConfidence = useDetailsPane((state) => state.setMetadataMinConfidence)
    const minConfidence = useDetailsPane((state) => state.metadata_min_confidence)
    return (
        <FilterContainer
            storageKey="extractedMetadetailOpen"
            label={<span>Extracted Metadata</span>}
            description={
                <span>Metadata extracted by models</span>
            }
            unMountOnCollapse
        >
            <FilterContainer
                storageKey="extractedMetadetailFilterOpen"
                label={<span>Metadata Filters</span>}
                description={
                    <span>Filter the displayed metadata</span>
                }
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={setterOptions}
                        currentValues={selectedSetters}
                        onSelectionChange={setSelectedSetters}
                        placeholder="Select Sources"
                        resetValue="*"
                        maxDisplayed={4}
                        buttonClassName="max-w-[350px]"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Confidence Threshold</span>}
                    confidence={minConfidence}
                    setConfidence={setMinConfidence}
                    description={<span>Minimum confidence for the metadata text</span>}
                />
            </FilterContainer>
            <div className="mt-4">
                {item && (
                    <MetadataList
                        item={item}
                        selectedSetters={selectedSetters}
                        minConfidence={minConfidence}
                    />)}
            </div>
        </FilterContainer>
    )
}

function MetadataList(
    {
        item,
        selectedSetters,
        minConfidence,
    }: {
        item: SearchResult,
        selectedSetters: string[],
        minConfidence: number,
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/items/item/text", {
        params: {
            query: {
                setters: selectedSetters,
                id: item.sha256,
                languages: ["metadata"],
                id_type: "sha256",
                ...dbs
            }
        }
    },
        {
            placeholderData: keepPreviousData
        }
    )
    const text = (
        data?.text.filter((t) => minConfidence > 0 ? (t.confidence || 0) >= minConfidence : true)
    ) || []
    return (
        <div className="mt-4">
            {text.map((t, i) => (
                <MetadataCard key={`${t.setter_name}-${i}`} text={t} />
            ))}
        </div>
    )
}
function MetadataCard(
    {
        text,
    }: {
        text: components["schemas"]["ExtractedText"]
    }
) {
    const metadata: [string, string, string | null][] = useMemo(() => {
        let meta_obj: { [key: string]: string }
        try {
            meta_obj = JSON.parse(text.text.replace(/'/g, '"'))
        } catch (e) {
            return [["Error", "Error parsing metadata", null]]
        }
        // return a list of key value pairs
        return Object.entries(meta_obj).map(([key, value]) => {
            const hostname = getHostName(value as string)
            if (hostname && key.toLowerCase().endsWith("_url")) {
                // Remove the _url suffix
                key = key.slice(0, -4)
            }
            return [snakeCaseToTitleCase(key), value as string, hostname]
        })
    }, [text])
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{text.setter_name} <span className="text-gray-400"> (Confidence {text.confidence?.toFixed(2)})</span></div>
                    {metadata.map(([key, value, hostname], i) => {
                        if (hostname) {
                            return <div key={i} className="text-gray-400 select-text ">
                                <b>{key}</b>: <a href={value} target="_blank" rel="noreferrer"> {hostname}</a>
                            </div>
                        }
                        return <div key={i} className="text-gray-400 select-text ">{key}: {value}</div>
                    })}
                </div>
            </div>
        </div>
    )
}

function snakeCaseToTitleCase(str: string) {
    return str.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
function getHostName(str: string) {
    try {
        return new URL(str).hostname
    } catch (e) {
        return null
    }
}