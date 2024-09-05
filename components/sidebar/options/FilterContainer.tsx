import { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { useFilterContainerOpen } from "@/lib/state/filterContainer";

interface FilterContainerProps {
    label: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    storageKey: string;
    defaultIsExpanded?: boolean; // Optional prop to set the default collapsed state
    contentClassname?: string;
    unMountOnCollapse?: boolean;
}

export function FilterContainer({
    label,
    description,
    children,
    storageKey,
    contentClassname,
    defaultIsExpanded = false, // Set default to false if not provided
    unMountOnCollapse = false,
}: FilterContainerProps) {
    const [isExpanded, setIsExpanded] = useFilterContainerOpen(storageKey, defaultIsExpanded);

    const toggleFilters = () => {
        setIsExpanded(!isExpanded);
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
                        className={
                            `h-4 w-4 transform transition-transform duration-300 ${isExpanded ? "rotate-0" : "rotate-90"
                            }`}
                    />
                </Button>
            </div>
            <div
                className={cn(`overflow-hidden transition-[max-height] duration-300 ease-in-out ${isExpanded ? "max-h-full" : "max-h-0"
                    }`, contentClassname ? contentClassname : "")}
            >
                {(isExpanded || !unMountOnCollapse) &&
                    children
                }
            </div>
        </div>
    );
}
