import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ReactNode, useEffect, useState } from "react"

export function ConfidenceFilter({
    confidence,
    setConfidence,
    label,
    description,
}: {
    confidence: number
    setConfidence: (value: number) => void
    label: ReactNode
    description?: ReactNode
}) {
    const [confidenceSlider, setConfidenceSlider] = useState([confidence])
    const updateConfidence = (value: number[]) => {
        setConfidence(value[0])
    }
    useEffect(() => {
        setConfidenceSlider([confidence])
    }, [confidence])
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        <span>{label}</span>
                    </Label>
                    <div className="text-gray-400">
                        <span>{description}</span>
                    </div>
                </div>
                <div className="text-lg">{confidenceSlider}</div>
            </div>
            <Slider
                value={confidenceSlider}
                onValueChange={setConfidenceSlider}
                onValueCommit={updateConfidence}
                max={1}
                min={0}
                step={0.01}
                className="mt-4"
            />
        </div>
    )
}