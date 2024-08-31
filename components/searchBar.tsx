"use client"
import { Input } from "@/components/ui/input"
import { useSearchQuery } from "@/lib/state/zust"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"
import { PLACEHOLDERS } from "@/lib/placeholders"
import { ClearSearch } from "./ClearSearch"

export function SearchBar() {
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
        checkInput(anyTextQuery, rawFts5Match)
    }, [rawFts5Match])

    const onFTS5Enable = (enabled: boolean) => {
        checkInput(anyTextQuery, enabled)
    }

    const onTextInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const match_string = e.target.value
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

    return (
        <>
            <div className="relative w-full">
                <Input
                    type="text"
                    placeholder={placeholder}
                    value={anyTextQuery}
                    onChange={onTextInputChange}
                    className="flex-grow"
                />
                {syntaxChecker.error && anyTextQuery && rawFts5Match && (
                    <div className="absolute left-0 mt-2 bg-red-500 text-white text-sm p-2 rounded-md shadow-md">
                        {syntaxChecker.error}
                    </div>
                )}
            </div>
            <ClearSearch />
            <Fts5ToggleButton onFTS5Enable={onFTS5Enable} />
        </>
    )
}