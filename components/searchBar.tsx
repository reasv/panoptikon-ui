"use client"
import { Input } from "@/components/ui/input"
import { useSearchQuery } from "@/lib/state/zust"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo, useState } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"
import { PLACEHOLDERS } from "@/lib/placeholders"
import { ClearSearch } from "./ClearSearch"
import { useTagCompletionEnabled } from "@/lib/enableTagsHook"
import { TagAutoComplete, TagCompletionInput } from "./tagInput"
import { useToast } from "./ui/use-toast"
import { Toggle } from "./ui/toggle"
import { Tag } from "lucide-react"
import { useTagCompletionSettings } from "@/lib/state/tagCompletion"
import { cn } from "@/lib/utils"

export function SearchBar({
    onSubmit,
}: {
    onSubmit?: () => void
}) {
    const setAnyTextQuery = useSearchQuery((state) => state.setAnyTextQuery)
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)
    const setEnabled = useSearchQuery((state) => state.setEnableSearch)
    const rawFts5Match = useSearchQuery((state) => state.any_text.raw_fts5_match)
    const syntaxChecker = useSQLite(rawFts5Match)
    const checkInput = (query: string, fts5Enabled: boolean) => {
        if (query.length === 0) {
            setEnabled(true)
            return
        }
        let error = false
        if (fts5Enabled) {
            const valid = syntaxChecker.executeQuery(query)
            if (!valid) {
                setEnabled(false)
                error = true
            }
        }
        if (!error) {
            setEnabled(true)
        }
    }
    useEffect(() => {
        if (syntaxChecker.error) {
            setEnabled(false)
        } else {
            setEnabled(true)
        }
    }, [syntaxChecker.error])

    useEffect(() => {
        checkInput(anyTextQuery, rawFts5Match)
    }, [rawFts5Match])

    const onFTS5Enable = (enabled: boolean) => {
        checkInput(anyTextQuery, enabled)
    }

    const onTextInputChange = (match_string: string) => {
        checkInput(match_string, rawFts5Match)
        // Trigram search requires at least 3 characters
        if (match_string.length > 0 && match_string.length < 3) {
            setEnabled(false)
        }
        setAnyTextQuery(match_string)
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
    const showError = syntaxChecker.error && anyTextQuery && rawFts5Match
    return (
        <>
            <TagCompletionSwitch />
            <div className="relative w-full">
                {completionEnabled ?
                    // <TagCompletionInput
                    //     placeholder={placeholder}
                    //     value={anyTextQuery}
                    //     onChange={onTextInputChange}
                    //     onSubmit={onSubmit}
                    //     inputClassName="flex-grow"
                    // />
                    <TagAutoComplete
                        placeholder={placeholder}
                        value={anyTextQuery}
                        onChange={onTextInputChange}
                        onSubmit={onSubmit}
                        inputClassName="flex-grow"
                        popoverClassName={showError ? "top-12" : ""}
                    />
                    :
                    <Input
                        type="text"
                        placeholder={placeholder}
                        value={anyTextQuery}
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
            </div >
            <ClearSearch />
            <Fts5ToggleButton onFTS5Enable={onFTS5Enable} />
        </>
    )
}

export function TagCompletionSwitch() {
    const isEnabled = useTagCompletionSettings((state) => state.enabled)
    const setEnabled = useTagCompletionSettings((state) => state.setEnabled)
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
