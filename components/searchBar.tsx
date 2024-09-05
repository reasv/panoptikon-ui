"use client"
import { Input } from "@/components/ui/input"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"
import { PLACEHOLDERS } from "@/lib/placeholders"
import { ClearSearch } from "./ClearSearch"
import { useTagCompletionEnabled } from "@/lib/enableTagsHook"
import { TagAutoComplete } from "./tagInput"
import { useToast } from "./ui/use-toast"
import { Toggle } from "./ui/toggle"
import { Tag } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAnyTextFilterOptions, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const [anyTextQuery, setAnyTextQuery] = useAnyTextFilterOptions()
    const [options, setOptions] = useQueryOptions()
    const setTextQuery = (value: string, valid: boolean) => {
        setAnyTextQuery({ query: value })
        setOptions({ s_enable: valid })
    }
    return (
        <TextSearchInput
            onSubmit={onSubmit}
            textQuery={anyTextQuery.query}
            setTextQuery={setTextQuery}
            fts5Enabled={options.at_fts5}
            setFts5Enabled={(value) => setOptions({ at_fts5: value })}
            setIsInputValid={(value) => setOptions({ s_enable: value })}
        />
    )
}

export function TextSearchInput({
    onSubmit,
    textQuery,
    setTextQuery,
    fts5Enabled,
    setFts5Enabled,
    setIsInputValid,
    noTagCompletion,
    noClearSearch,
}: {
    onSubmit?: () => void,
    textQuery: string,
    setTextQuery: (value: string, valid: boolean) => void,
    fts5Enabled: boolean,
    setFts5Enabled: (value: boolean) => void
    setIsInputValid: (value: boolean) => void
    noTagCompletion?: boolean,
    noClearSearch?: boolean
}) {
    const syntaxChecker = useSQLite(fts5Enabled)
    const checkInput = (query: string, fts5Enabled: boolean) => {
        if (query.length === 0) {
            setIsInputValid(true)
            return true
        }
        let error = false
        if (fts5Enabled) {
            const valid = syntaxChecker.executeQuery(query)
            if (!valid) {
                setIsInputValid(false)
                error = true
            }
        }
        if (!error) {
            setIsInputValid(true)
        }
        return !error
    }
    useEffect(() => {
        if (syntaxChecker.error) {
            setIsInputValid(false)
        } else {
            setIsInputValid(true)
        }
    }, [syntaxChecker.error])

    useEffect(() => {
        checkInput(textQuery, fts5Enabled)
    }, [fts5Enabled])

    const onFTS5Enable = (enabled: boolean) => {
        checkInput(textQuery, enabled)
        setFts5Enabled(enabled)
    }

    const onTextInputChange = (match_string: string) => {
        let valid = checkInput(match_string, fts5Enabled)
        // Trigram search requires at least 3 characters
        if (match_string.length > 0 && match_string.length < 3) {
            setIsInputValid(false)
            valid = false
        }
        setTextQuery(match_string, valid)
    }

    const placeholder = useMemo(() => {
        const currentMinute = new Date().getMinutes();
        return PLACEHOLDERS[currentMinute % PLACEHOLDERS.length];
    }, [PLACEHOLDERS]);

    const [completionEnabled, _] = useTagCompletionEnabled()

    const handleKeyDown = (e:
        React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (onSubmit) {
                onSubmit()
            }
        }
    }
    const showError = syntaxChecker.error && textQuery.length > 0 && fts5Enabled
    return (
        <>
            <TagCompletionSwitch />
            <div className="relative w-full">
                {completionEnabled && !noTagCompletion ?
                    <TagAutoComplete
                        placeholder={placeholder}
                        value={textQuery}
                        onChange={onTextInputChange}
                        onSubmit={onSubmit}
                        inputClassName="flex-grow"
                        popoverClassName={showError ? "top-12" : ""}
                    />
                    :
                    <Input
                        type="text"
                        placeholder={placeholder}
                        value={textQuery}
                        onChange={(e) => onTextInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-grow"
                    />
                }
                {showError && (
                    <div className={cn("absolute mt-2 bg-red-500",
                        "text-white text-sm p-2 rounded-md shadow-md z-50")}>
                        {syntaxChecker.error}
                    </div>
                )}
            </div>
            {!noClearSearch && <ClearSearch />}
            <Fts5ToggleButton isFTS5Enabled={fts5Enabled} onFTS5Enable={onFTS5Enable} />
        </>
    )
}

export function TagCompletionSwitch() {
    const [isEnabled, setEnabled, tagsExist] = useTagCompletionEnabled()
    const { toast } = useToast()

    const onClickToggle = () => {
        const newValue = !isEnabled
        setEnabled(newValue)

        let description = "Tag completion will be enabled"
        if (!newValue) {
            description = "Tag completion will be disabled"
        }
        toast({
            title: `Tag Completion is ${newValue ? "ON" : "OFF"}`,
            description,
            duration: 2000
        })
    }

    return (
        tagsExist &&
        <Toggle
            pressed={isEnabled}
            onClick={onClickToggle}
            title={isEnabled ? "Tag Completion Enabled" : "Tag Completion Disabled"}
            aria-label={isEnabled ? "Disable Tag Completion" : "Enable Tag Completion"}
        >
            <Tag className="h-4 w-4" />
        </Toggle>
    )
}
