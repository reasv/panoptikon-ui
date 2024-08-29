import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ReactNode, useEffect, useState } from "react"

export function ConfidenceFilter({
    confidence,
    setConfidence,
    label,
    description,
    min,
    max,
    step,
}: {
    confidence: number
    setConfidence: (value: number) => void
    label: ReactNode
    description?: ReactNode
    min?: number
    max?: number
    step?: number
}) {
    const [confidenceSlider, setConfidenceSlider] = useState([confidence])
    const updateConfidence = (value: number[]) => {
        setConfidence(value[0])
    }
    useEffect(() => {
        setConfidenceSlider([confidence])
    }, [confidence])
    const minValue = min || 0
    const maxValue = max || 1
    const stepValue = step || 0.01
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
                max={maxValue}
                min={minValue}
                step={stepValue}
                className="mt-4"
            />
        </div>
    )
}