
import { Label } from "../../ui/label"
import { Slider } from "../../ui/slider"
import { useEffect, useState } from "react"
import { Button } from "../../ui/button"
import { PlusCircle, MinusCircle } from "lucide-react"

const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 10000
// The slider works in "position" space and maps logarithmically onto page
// sizes, so a given amount of thumb travel is roughly a constant *ratio*
// change. That keeps single-digit precision near the low end while still
// reaching 10k without the thumb becoming unusably twitchy.
//
// The curve is offset by LOG_OFFSET rather than being a pure log: a pure
// log spends so many positions on the low end that a keyboard arrow press
// at page size 1 doesn't change the value at all (it takes ~45 of them to
// reach 2). Offsetting makes the bottom of the range near-linear, so every
// arrow press moves by one, while the top stays logarithmic.
//
// SLIDER_STEPS is deliberately close to the track's pixel width — extra
// positions past that aren't addressable by mouse and only serve to make
// keyboard steps smaller.
const SLIDER_STEPS = 200
const LOG_OFFSET = 20
const LOG_RANGE = Math.log(
    (MAX_PAGE_SIZE + LOG_OFFSET) / (MIN_PAGE_SIZE + LOG_OFFSET)
)

// Snap to increments that feel natural at each magnitude. Without this the
// log curve produces values like 3847, which nobody wants to land on.
function snap(value: number): number {
    const increment =
        value < 20 ? 1
            : value < 100 ? 5
                : value < 500 ? 10
                    : value < 2000 ? 50
                        : 100
    return Math.round(value / increment) * increment
}

function clamp(value: number): number {
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, value))
}

function positionToValue(position: number): number {
    const raw = (MIN_PAGE_SIZE + LOG_OFFSET)
        * Math.exp((position / SLIDER_STEPS) * LOG_RANGE) - LOG_OFFSET
    return clamp(snap(raw))
}

function valueToPosition(value: number): number {
    const ratio = (clamp(value) + LOG_OFFSET) / (MIN_PAGE_SIZE + LOG_OFFSET)
    return Math.round((Math.log(ratio) / LOG_RANGE) * SLIDER_STEPS)
}

export function PageSizeControl(
    {
        pageSize,
        setPageSize
    }: {
        pageSize: number,
        setPageSize: (value: number) => void
    }
) {
    const [pendingPageSize, setPendingPageSize] = useState(pageSize)
    function updatePageSize() {
        setPageSize(pendingPageSize)
    }
    function onSliderChange(position: number[]) {
        setPendingPageSize(positionToValue(position[0]))
    }
    function onPlus() {
        const next = clamp(pendingPageSize + 1)
        setPendingPageSize(next)
        setPageSize(next)
    }
    function onMinus() {
        const next = clamp(pendingPageSize - 1)
        setPendingPageSize(next)
        setPageSize(next)
    }
    useEffect(() => {
        setPendingPageSize(pageSize)
    }, [pageSize])
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
                {/* shrink-0 + a width reserved for the widest value (5 digits)
                    keeps this cluster a constant width, so the description
                    beside it doesn't reflow as the number grows while dragging. */}
                <div className="flex flex-row items-center shrink-0">
                    <Button disabled={pendingPageSize <= MIN_PAGE_SIZE} onClick={() => onMinus()} title="Decrease" variant="ghost" size="icon">
                        <MinusCircle className="h-4 w-4" />
                    </Button>
                    <div className="text-lg mx-2 w-14 text-center tabular-nums">{pendingPageSize}</div>
                    <Button disabled={pendingPageSize >= MAX_PAGE_SIZE} onClick={() => onPlus()} title="Increase" variant="ghost" size="icon">
                        <PlusCircle className="h-4 w-4" />
                    </Button>
                </div>

            </div>
            <Slider
                value={[valueToPosition(pendingPageSize)]}
                onValueChange={onSliderChange}
                onValueCommit={updatePageSize}
                max={SLIDER_STEPS}
                min={0}
                step={1}
                className="mt-4"
            />
        </div>
    )
}
