"use client";

import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";

// Define the prop types for the CollapsibleFilters component
interface CollapsibleFiltersProps {
    label: ReactNode;  // The label can be a string, JSX, or any valid React node
    description?: ReactNode;  // The description is optional and can also be any React node
    children: ReactNode;  // The children will be the content inside the collapsible area
}

export function CollapsibleFilters({ label, description, children }: CollapsibleFiltersProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const toggleFilters = () => {
        setIsExpanded((prev) => !prev);
    };

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">
                        {label}
                    </div>
                    {description && (
                        <div className="text-gray-400">
                            {description}
                        </div>
                    )}
                </div>
                <Button title="Hide these filters" variant="ghost" size="icon" onClick={toggleFilters}>
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
