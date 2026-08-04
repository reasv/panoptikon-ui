"use client"
import { useToast } from "@/components/ui/use-toast"
import {
    useGalleryPinBoardLayout,
    useGalleryPinProportional,
} from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { composeBoardMosaic } from "@/lib/pinboardMosaic"
import { findBoardElement, findBoardViewport } from "@/lib/pinboardPreview"
import { downloadBlob, sanitizeFilePart, timestampStamp } from "@/lib/download"
import { exportGuard, useExporting } from "@/lib/pinboardExportGuard"
import {
    usePinboardExportLossless,
    usePinboardMosaicExtent,
    usePinboardMosaicSeamless,
} from "@/lib/state/pinboardMosaicPrefs"
import { prettyPrintBytes } from "@/lib/utils"
import type { MenuKit } from "./PinboardGlobalMenu"

// "Save Mosaic Image": the board composited client-side into one JPEG and
// downloaded. Two surfaces offer it — the pinboard tab's chevron menu (as
// a submenu next to Save) and the fullscreen toolbar (as its own dropdown,
// like Layout) — so the rows live in one component taking a MenuKit, the
// same way the board-global section does.
//
// What is captured is the LIVE URL state, unsaved edits included: the
// compositor parses the same `pinboard` param the board renders from, so
// what you see is what you save, whether or not the board was ever saved
// to the server.

// Width presets. "Window" is the board's own measured width — the picture
// the user is looking at, at 1:1 — and the rest upscale from it.
const MOSAIC_PRESETS = [1920, 2560, 3840]

// The in-progress toast outlives the composite by design; it is dismissed
// on completion, so this is only the ceiling for an export that never
// returns at all.
const PROGRESS_TOAST_MS = 10 * 60 * 1000

/**
 * Non-zero measurement, or the window as the unmounted-board fallback.
 *
 * The fallback OVERSTATES the viewport for the height (the board's scroll
 * pane is shorter than the window: header, toolbar, chrome), so an export
 * fired while the board is unmounted captures a few more rows than the fold
 * would. Accepted, and deliberately the same trade pinboardSave.ts makes
 * for the width (`findBoardElement()?.clientWidth ?? window.innerWidth`):
 * an approximate capture beats refusing to export, and the case only
 * arises when nothing is on screen to measure.
 */
function measured(px: number | undefined, fallback: number): number {
    return px && px > 0 ? px : fallback
}

/** True while any image export is in flight, anywhere in the app. */
export function useMosaicExporting(): boolean {
    return useExporting()
}

export function useMosaicExport(boardName?: string | null) {
    const [layout] = useGalleryPinBoardLayout()
    const dbs = useSelectedDBs()[0]
    const [proportional] = useGalleryPinProportional()
    const [seamless] = usePinboardMosaicSeamless()
    const [extent] = usePinboardMosaicExtent()
    const [lossless] = usePinboardExportLossless()
    const { toast } = useToast()
    // Compositing is async (every thumbnail is a network fetch), so the
    // rows disable themselves for the duration; the guard that actually
    // stops a second composite is the module-level flag above.
    const busy = useMosaicExporting()

    // `targetWidth` null means the live board width (the "Window" preset).
    const save = async (targetWidth: number | null) => {
        if (exportGuard.busy || layout.length === 0) return
        exportGuard.set(true)
        const boardWidth = measured(
            findBoardElement()?.clientWidth, window.innerWidth)
        const boardHeight = measured(
            findBoardViewport()?.clientHeight, window.innerHeight)
        // A big composite can take a while, and a silent wait is what
        // invites the second click: the in-progress toast stays up until
        // the outcome replaces it.
        const progress = toast({
            title: "Saving mosaic…",
            description: "Compositing the board",
            duration: PROGRESS_TOAST_MS,
        })
        try {
            const background =
                getComputedStyle(document.body).backgroundColor || "#09090b"
            const result = await composeBoardMosaic({
                layout,
                dbs,
                boardWidth,
                boardHeight,
                targetWidth: targetWidth ?? boardWidth,
                seamless,
                extent,
                proportional,
                lossless,
                background,
            })
            progress.dismiss()
            if (!result.ok) {
                // "Everything is below the fold" is a wrong extent, not a
                // broken export, so it says which switch fixes it.
                if (result.failure === "empty-visible") {
                    toast({
                        title: "Nothing above the fold",
                        description: "Every pin on this board sits below the"
                            + " visible area — switch the mosaic to Entire"
                            + " Board to capture it.",
                        duration: 6000,
                    })
                    return
                }
                throw new Error(`mosaic geometry: ${result.failure}`)
            }
            const mosaic = result.mosaic
            const stem = sanitizeFilePart(boardName ?? "") || "pinboard"
            const filename = `${stem}-${timestampStamp()}.${mosaic.extension}`
            downloadBlob(mosaic.blob, filename)
            // The canvas guard may have had to shrink the request: say so,
            // or the file silently isn't the preset that was clicked.
            const clamped = mosaic.clampedWidth !== null
            // Size is worth stating for a lossless mosaic: a full-width PNG
            // is tens of megabytes, and nothing else on screen says so.
            const size = `${mosaic.width}×${mosaic.height}`
                + (lossless ? `, ${prettyPrintBytes(mosaic.blob.size)}` : "")
            toast({
                title: clamped ? "Mosaic saved, scaled down" : "Mosaic saved",
                description: clamped
                    ? `${filename} — that size exceeds what browsers can draw`
                        + ` on one canvas, so it was saved at ${size}.`
                    : `${filename} (${size})`,
                duration: clamped ? 6000 : 4000,
            })
        } catch (err) {
            console.error("pinboard mosaic export failed", err)
            progress.dismiss()
            toast({
                title: "Error",
                description: "Failed to save the mosaic image",
                duration: 4000,
            })
        } finally {
            exportGuard.set(false)
        }
    }
    return { save, busy }
}

/**
 * The format toggle, shared by every export surface so the wording of what
 * PNG actually buys can't drift between them. `composite` is true for the
 * mosaics, where the honest headline is the transparency rather than the
 * missing re-encode: a mosaic's gutters, letterboxing, rounded corners and
 * (for a selection) the holes left by unselected items are all background
 * today, and all alpha here.
 */
export function LosslessMenuItem({
    kit,
    composite,
}: {
    kit: MenuKit
    composite: boolean
}) {
    const [lossless, setLossless] = usePinboardExportLossless()
    const { CheckboxItem } = kit
    return (
        <CheckboxItem
            checked={lossless}
            title={composite
                ? "Save as PNG: gaps, letterboxing and rounded corners come"
                    + " out transparent instead of filled with the page"
                    + " background, with no re-encoding loss. Much larger files."
                : "Save as PNG instead of JPEG: no re-encoding loss,"
                    + " transparency preserved, much larger files"}
            onCheckedChange={(checked) => setLossless(!!checked)}
        >
            {composite ? "PNG (Lossless, Transparent)" : "PNG (Lossless)"}
        </CheckboxItem>
    )
}

/**
 * The rows themselves: the size presets (each one composes and downloads
 * on click), the extent choice, and the seamless and PNG toggles. Every
 * preference persists in localStorage only (see state/pinboardMosaicPrefs).
 */
export function MosaicMenuItems({
    kit,
    boardName,
}: {
    kit: MenuKit
    // The saved board's name, when the live board came from one; it
    // becomes the filename stem, with "pinboard" as the fallback.
    boardName?: string | null
}) {
    const { save, busy } = useMosaicExport(boardName)
    const [seamless, setSeamless] = usePinboardMosaicSeamless()
    const [extent, setExtent] = usePinboardMosaicExtent()
    const { Item, CheckboxItem, Separator } = kit
    return (
        <>
            <Item disabled={busy} onClick={() => void save(null)}>
                Window Size
            </Item>
            {MOSAIC_PRESETS.map((w) => (
                <Item key={w} disabled={busy} onClick={() => void save(w)}>
                    {`${w} px Wide`}
                </Item>
            ))}
            <Separator />
            {/* Radio pair, drawn with the kit's checkbox rows (Radix's
                radio items aren't in the shared kit, and the check mark
                reads the same): clicking the checked one keeps it, so the
                choice can never be emptied. */}
            <CheckboxItem
                checked={extent === "visible"}
                title={"The rows the board is meant to show — the current"
                    + " fold or the layout's ratcheted height"}
                onCheckedChange={() => setExtent("visible")}
            >
                Visible Area
            </CheckboxItem>
            <CheckboxItem
                checked={extent === "full"}
                title="Everything on the board, including below the fold"
                onCheckedChange={() => setExtent("full")}
            >
                Entire Board
            </CheckboxItem>
            <Separator />
            {/* Each cell absorbs its own margins, so pins share edges and
                the image has no background showing anywhere */}
            <CheckboxItem
                checked={seamless}
                title="Tile the pins edge to edge, with no gaps or padding"
                onCheckedChange={(checked) => setSeamless(!!checked)}
            >
                Seamless (No Gaps)
            </CheckboxItem>
            <LosslessMenuItem kit={kit} composite />
        </>
    )
}

/** The same rows as a submenu, for the board menus. */
export function MosaicSubmenu({
    kit,
    boardName,
}: {
    kit: MenuKit
    boardName?: string | null
}) {
    const [layout] = useGalleryPinBoardLayout()
    const hasPins = layout.length > 0
    const { Sub, SubTrigger, SubContent } = kit
    return (
        <Sub>
            {/* Radix puts pointer-events-none on a disabled row, so the
                reason goes in the label rather than a tooltip — the same
                trade the Gravity row makes. */}
            <SubTrigger inset disabled={!hasPins}>
                {hasPins
                    ? "Save Mosaic Image"
                    : "Save Mosaic Image (pin something first)"}
            </SubTrigger>
            <SubContent className="w-56">
                <MosaicMenuItems kit={kit} boardName={boardName} />
            </SubContent>
        </Sub>
    )
}
