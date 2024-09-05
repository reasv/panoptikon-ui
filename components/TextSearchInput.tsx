import { Input } from "@/components/ui/input"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo, useRef, useState } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"
import { PLACEHOLDERS } from "@/lib/placeholders"
import { ClearSearch } from "./ClearSearch"
import { useTagCompletionEnabled } from "@/lib/enableTagsHook"
import { TagAutoComplete } from "./tagInput"
import { cn } from "@/lib/utils"
import { TagCompletionSwitch } from "./TagCompleteSwitch"

const checkIsInputValid = (
    query: string,
    checkSyntax: (query: string) => boolean
) => {
    if (query.length === 0) {
        return true
    }
    const valid = checkSyntax(query)
    if (!valid) {
        return false
    }
    return true
}

export function TextSearchInput({
    onSubmit,
    textQuery,
    setTextQuery,
    fts5Enabled,
    setFts5Enabled,
    noTagCompletion,
    noClearSearch,
}: {
    onSubmit?: () => void,
    textQuery: string,
    setTextQuery: (value: string) => void,
    fts5Enabled: boolean,
    setFts5Enabled: (value: boolean) => boolean // Returns true if fts5 was enabled
    noTagCompletion?: boolean,
    noClearSearch?: boolean
}) {
    const [value, setValue] = useState(textQuery)
    const isTyping = useRef(false) // Track if the user is actively typing

    useEffect(() => {
        if (!isTyping.current && value !== textQuery) {
            setValue(textQuery)
        }
    }, [textQuery])

    const [isInputValid, setIsInputValid] = useState(true)
    const syntaxChecker = useSQLite(fts5Enabled)

    const updateInputValidity = (inputText: string) => {
        const valid = checkIsInputValid(inputText, syntaxChecker.executeQuery)
        setIsInputValid(valid)
        return valid
    }

    const onFTS5Enable = async (enabled: boolean) => {
        if (!enabled) { // Disable FTS5
            if (setFts5Enabled(false)) {
                setIsInputValid(true) // Reset input validity when disabling FTS5
                setTextQuery(value) // Set the query to the current value
                return true
            }
            return false
        } else { // Enable FTS5
            await syntaxChecker.forceLoad()
            if (!updateInputValidity(textQuery)) return false
            return setFts5Enabled(enabled)
        }
    }

    const onTextInputChange = (inputText: string) => {
        setValue(inputText)
        isTyping.current = true // Mark that the user is actively typing
        // Reset the typing flag after some delay (debounce-like effect)
        setTimeout(() => {
            isTyping.current = false
        }, 400) // Adjust delay based on UX needs

        if (fts5Enabled) {
            if (!updateInputValidity(inputText)) {
                return
            }
        } else {
            setIsInputValid(true)
        }
        // Trigram search requires at least 3 characters
        if (inputText.length > 0 && inputText.length < 3) {
            return
        }
        setTextQuery(inputText)
    }

    const placeholder = useMemo(() => {
        const currentMinute = new Date().getMinutes()
        return PLACEHOLDERS[currentMinute % PLACEHOLDERS.length]
    }, [PLACEHOLDERS])

    const [completionEnabled, _] = useTagCompletionEnabled()

    const handleKeyDown = (e:
        React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (onSubmit) {
                onSubmit()
            }
        }
    }

    const showError = syntaxChecker.error && value.length > 0 && !isInputValid
    return (
        <>
            {!noTagCompletion && <TagCompletionSwitch />}
            <div className="relative w-full">
                {completionEnabled && !noTagCompletion ?
                    <TagAutoComplete
                        placeholder={placeholder}
                        value={value}
                        onChange={onTextInputChange}
                        onSubmit={onSubmit}
                        inputClassName="flex-grow"
                        popoverClassName={showError ? "top-12" : ""}
                    />
                    :
                    <Input
                        type="text"
                        placeholder={placeholder}
                        value={value}
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