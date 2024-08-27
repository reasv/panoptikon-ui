"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch";
import { MultiBoxResponsive } from "./multiCombobox";
import { Slider } from "./ui/slider";
import { useState } from "react";
import { Button } from "./ui/button";
import { PlusCircle, MinusCircle } from "lucide-react";

export function PageSizeSlider() {
    const { data } = $api.useQuery("get", "/api/bookmarks/ns")
    const pageSize = useSearchQuery((state) => state.order_args.page_size)
    const [pageSizeSlider, setPageSizeSlider] = useState([pageSize])
    const setPageSize = useSearchQuery((state) => state.setPageSize)
    function updatePageSize() {
        setPageSize(pageSizeSlider[0])
    }
    function onPlus() {
        setPageSizeSlider([pageSizeSlider[0] + 1])
        setPageSize(pageSizeSlider[0] + 1)
    }
    function onMinus() {
        setPageSizeSlider([pageSizeSlider[0] - 1])
        setPageSize(pageSizeSlider[0] - 1)
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Page Size
                    </Label>
                    <div className="text-gray-400">
                        How many items to display per page
                    </div>
                </div>
                <div className="flex flex-row items-center">
                    <Button disabled={pageSizeSlider[0] === 1} onClick={() => onMinus()} title="Decrease" variant="ghost" size="icon">
                        <MinusCircle className="h-4 w-4" />
                    </Button>
                    <div className="text-lg ml-4 mr-4">{pageSizeSlider}</div>
                    <Button onClick={() => onPlus()} title="Increase" variant="ghost" size="icon">
                        <PlusCircle className="h-4 w-4" />
                    </Button>
                </div>

            </div>
            <Slider
                value={pageSizeSlider}
                onValueChange={setPageSizeSlider}
                onValueCommit={updatePageSize}
                max={250}
                min={1}
                step={1}
                className="mt-4"
            />
        </div>
    )
}