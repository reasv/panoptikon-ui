"use client"
import { Input } from "@/components/ui/input"
import { useSearchQuery } from "@/lib/zust"
import { useSQLite } from "@/lib/sqliteChecker"
import { useEffect, useMemo } from "react"
import { Fts5ToggleButton } from "./FTS5Toggle"

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
    // Define an array of placeholder phrases
    const placeholderPhrases = [
        "What do you want to find today?",
        "What are you searching for?",
        "Find what you're looking for.",
        "What will you discover today?",
        "Search your next adventure.",
        "Looking for something?",
        "Explore new ideas.",
        "What’s on your mind?",
        "Search your journey.",
        "Find your inspiration.",
        "Seek, and you shall find!",
        "Get your search on!",
        "Uncover what clicks today.",
        "Go ahead, make a query.",
        "Finders, seekers!",
        "On the hunt? Start here.",
        "Let’s search and rescue that info.",
        "Your quest begins here.",
        "Navigate your way to answers.",
        "Discover the unknown.",
        "Search for the truth.",
        "Find the needle in the haystack.",
        "Search for the key to success.",
        "Find the missing piece.",
        "Search for the golden ticket.",
        "Seek and you shall find.",
        "Search for the moon, reach the stars.",
    ];

    // Get the current minute and use it to select a phrase
    const placeholder = useMemo(() => {
        const currentMinute = new Date().getMinutes();
        // Select a phrase based on the current minute
        return placeholderPhrases[currentMinute % placeholderPhrases.length];
    }, [placeholderPhrases]);

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
            <Fts5ToggleButton onFTS5Enable={onFTS5Enable} />
        </>
    )
}