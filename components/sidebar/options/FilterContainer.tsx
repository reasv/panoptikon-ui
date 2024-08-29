"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";

interface FilterContainerProps {
    label: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    storageKey: string;
    defaultIsCollapsed?: boolean; // Optional prop to set the default collapsed state
}

export function FilterContainer({
    label,
    description,
    children,
    storageKey,
    defaultIsCollapsed = false, // Set default to false if not provided
}: FilterContainerProps) {
    const [isExpanded, setIsExpanded] = useState<boolean>(() => {
        // Check localStorage first, then fallback to defaultIsCollapsed
        const savedState = localStorage.getItem(storageKey);
        if (savedState !== null) {
            return savedState === "true";
        }
        return !defaultIsCollapsed; // Default to true if not collapsed
    });

    // Toggle the expanded/collapsed state and save it to localStorage
    const toggleFilters = () => {
        setIsExpanded((prev) => {
            const newState = !prev;
            localStorage.setItem(storageKey, newState.toString());
            return newState;
        });
    };

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{label}</div>
                    {description && <div className="text-gray-400">{description}</div>}
                </div>
                <Button
                    title="Hide these filters"
                    variant="ghost"
                    size="icon"
                    onClick={toggleFilters}
                >
                    <ChevronDown
                        className={`h-4 w-4 transform transition-transform duration-300 ${isExpanded ? "rotate-0" : "rotate-90"
                            }`}
                    />
                </Button>
            </div>
            <div
                className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${isExpanded ? "max-h-screen" : "max-h-0"
                    }`}
            >
                {children}
            </div>
        </div>
    );
}
