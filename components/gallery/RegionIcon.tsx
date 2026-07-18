import { RegionPreset } from "@/hooks/pinboardLayout"

// Tiny board diagram for the Send to Region menus: the outline is the
// board, the filled band the target region — which preset is which should
// be readable at a glance, not deciphered from the label.
const REGION_FRACTIONS: Record<RegionPreset, [number, number]> = {
    "viewport": [0, 1],
    "left-half": [0, 1 / 2],
    "right-half": [1 / 2, 1 / 2],
    "left-third": [0, 1 / 3],
    "center-third": [1 / 3, 1 / 3],
    "right-third": [2 / 3, 1 / 3],
    "left-two-thirds": [0, 2 / 3],
    "right-two-thirds": [1 / 3, 2 / 3],
}

export function RegionIcon({
    preset,
    className,
}: {
    preset: RegionPreset
    className?: string
}) {
    const [fx, fw] = REGION_FRACTIONS[preset]
    // Same 24x24 frame and stroke weight as the surrounding lucide icons
    const bx = 3, by = 5, bw = 18, bh = 14
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <rect x={bx} y={by} width={bw} height={bh} rx="2" />
            {/* Semi-opaque fill keeps the board outline readable through the
                band, including when the region IS the whole board */}
            <rect
                x={bx + fx * bw}
                y={by}
                width={fw * bw}
                height={bh}
                rx="1"
                fill="currentColor"
                stroke="none"
                opacity="0.55"
            />
        </svg>
    )
}
