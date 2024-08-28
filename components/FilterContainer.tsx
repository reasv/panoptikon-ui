"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";

interface FilterContainerProps {
    label: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    storageKey: string; // Add a storageKey prop to make the localStorage key unique
}

export function FilterContainer({ label, description, children, storageKey }: FilterContainerProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    // Load the expanded/collapsed state from localStorage on mount
    useEffect(() => {
        const savedState = localStorage.getItem(storageKey);
        if (savedState !== null) {
            setIsExpanded(savedState === "true");
        }
    }, [storageKey]);

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
