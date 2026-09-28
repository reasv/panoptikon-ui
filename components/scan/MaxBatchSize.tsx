import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useEffect, useState } from "react"

// Initial cap when the user switches Auto off.
const DEFAULT_CAP = 64

/**
 * Max batch size: `null` is auto (the inference server sizes batches), a
 * number only lowers that ceiling. The switch updates optimistically and
 * reverts when `setValue` resolves `false`.
 */
export function MaxBatchSize({
    value,
    setValue,
}: {
    value: number | null | undefined
    setValue: (value: number | null) => Promise<boolean>
}) {
    const savedCap = typeof value === "number" && value > 0 ? value : null
    const [capped, setCapped] = useState(savedCap !== null)
    // Kept so switching Auto off again restores the user's own cap.
    const [lastCap, setLastCap] = useState(savedCap ?? DEFAULT_CAP)
    const [slider, setSlider] = useState([savedCap ?? DEFAULT_CAP])
    useEffect(() => {
        setCapped(savedCap !== null)
        if (savedCap !== null) {
            setSlider([savedCap])
            setLastCap(savedCap)
        }
    }, [savedCap])

    const toggleAuto = async (auto: boolean) => {
        setCapped(!auto)
        if (!auto) {
            setSlider([lastCap])
        }
        if (!(await setValue(auto ? null : lastCap))) {
            setCapped(savedCap !== null)
            setSlider([savedCap ?? lastCap])
        }
    }

    const commitCap = async (cap: number) => {
        setLastCap(cap)
        if (!(await setValue(cap))) {
            setSlider([savedCap ?? DEFAULT_CAP])
        }
    }

    const tooltip = capped
        ? `Never more than ${slider[0]} items at once.`
        : "Batch size is chosen automatically; switch Auto off to set a ceiling."
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base" title={tooltip}>
                        <span>Max Batch Size</span>
                    </Label>
                    <div className="text-gray-400">
                        <span>
                            On Auto, the server picks the largest batch that fits in VRAM
                        </span>
                    </div>
                </div>
                <div className="flex flex-row items-center gap-3">
                    <div className="text-lg">{capped ? slider[0] : "Auto"}</div>
                    <Switch
                        checked={!capped}
                        onCheckedChange={toggleAuto}
                        aria-label="Let the server choose the batch size"
                    />
                </div>
            </div>
            {capped && (
                <>
                    <Slider
                        value={slider}
                        onValueChange={setSlider}
                        onValueCommit={(committed) => commitCap(committed[0])}
                        min={1}
                        max={256}
                        step={1}
                        className="mt-4"
                        aria-label="Max batch size"
                    />
                    <div className="mt-2 text-sm text-gray-400">{tooltip}</div>
                </>
            )}
        </div>
    )
}

export function formatMaxBatchSize(value: number | null | undefined) {
    return typeof value === "number" && value > 0 ? String(value) : "Auto"
}
