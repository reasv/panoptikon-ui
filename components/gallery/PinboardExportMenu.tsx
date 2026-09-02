"use client"
import { useToast } from "@/components/ui/use-toast"
import { fetchClient } from "@/lib/api"
import {
    downloadBlob,
    downloadURL,
    sanitizeFilePart,
    timestampStamp,
} from "@/lib/download"
import { isIdentityOrientation } from "@/lib/pinboardCrop"
import { exportGuard, useExporting } from "@/lib/pinboardExportGuard"
import { parsePlacements } from "@/lib/pinboardGeometry"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"
import { ItemImageTarget, composeItemImage } from "@/lib/pinboardItemImage"
import { composeBoardMosaic } from "@/lib/pinboardMosaic"
import { findBoardElement, findBoardViewport } from "@/lib/pinboardPreview"
import {
    usePinboardExportLossless,
    usePinboardMosaicSeamless,
} from "@/lib/state/pinboardMosaicPrefs"
import {
    useGalleryPinBoardLayout,
    useGalleryPinProportional,
} from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { prettyPrintBytes } from "@/lib/utils"
import { originalFileURL } from "@/lib/thumbnailURL"
import {
    AnimatedItemRows,
    AnimatedMosaicRows,
    LosslessMenuItem,
} from "./PinboardMosaicMenu"
import { SectionLabel, type MenuKit } from "./PinboardGlobalMenu"

// Saving the SELECTION as an image, from the selection toolbar and from a
// pin's own context menu.
//
// Two exports behind one menu, chosen by how many items are selected:
//
//   2+  A mosaic of exactly those items — the board's own export restricted
//       to their layout keys, so the arrangement is the one on screen and
//       the capture box is their bounding box. Items in between that were
//       not selected leave their gaps behind: packing the selection would
//       save a composition the user never saw, and the layout verbs exist
//       for closing gaps first.
//
//   1   The item itself, cropped and oriented exactly as the board shows
//       it, at the SOURCE's resolution rather than the cell's, with no
//       letterboxing and no background. That turns crop + rotate + flip
//       into an image editor whose output leaves the app — the same tools
//       that arrange a board also cut a picture out of one.
//
// The width presets mean the width of the FILE here, not the width the
// board is laid out at (what the whole-board export's presets mean): a
// selection is some fraction of the board, so laying the board out at 3840
// would hand back a few hundred pixels with "3840 px" on the row that
// produced it.

// Shared with the board mosaic's menu; "Window" is measured, not listed.
const EXPORT_PRESETS = [1920, 2560, 3840]

// Ceiling for the in-progress toast, which is dismissed on completion:
// it only expires on an export that never returns at all.
const PROGRESS_TOAST_MS = 10 * 60 * 1000

/**
 * An indexed path's basename split into stem and extension. The stem names
 * every export from this item; the extension only comes back for the
 * pass-through save, which hands over the original bytes and must therefore
 * hand over the original format's name too (the `download` attribute IS the
 * filename — an extensionless one lands as a file nothing will open).
 */
function nameOfPath(path: string): { stem: string; ext: string } {
    const base = path.split(/[\\/]/).pop() ?? ""
    const dot = base.lastIndexOf(".")
    return dot > 0
        ? {
            stem: sanitizeFilePart(base.slice(0, dot)),
            ext: `.${sanitizeFilePart(base.slice(dot + 1), 16)}`,
        }
        : { stem: sanitizeFilePart(base), ext: "" }
}

/**
 * What a size row does. "window" is the picture at its on-screen size, and
 * "native" (single item only) is the source's own resolution.
 */
type ExportSize = { kind: "window" } | { kind: "native" } | { kind: "px"; px: number }

/**
 * The selection export. `keys` is the live selection (or the one pin a
 * context menu speaks for); everything else — the records, the crops, the
 * board's measured size — is read at save time, so a menu left open across
 * an edit still exports what is on the board now.
 */
export function useSelectionExport(keys: string[]) {
    const [layout] = useGalleryPinBoardLayout()
    const dbs = useSelectedDBs()[0]
    const [proportional] = useGalleryPinProportional()
    const [seamless] = usePinboardMosaicSeamless()
    const [lossless] = usePinboardExportLossless()
    const { toast } = useToast()
    const busy = useExporting()

    const fail = (progress: { dismiss: () => void }, err: unknown) => {
        console.error("pinboard selection export failed", err)
        progress.dismiss()
        toast({
            title: "Error",
            description: "Failed to save the image",
            duration: 4000,
        })
    }

    const save = async (size: ExportSize) => {
        if (exportGuard.busy || keys.length === 0) return
        exportGuard.set(true)
        // Same fallback the board export documents: an unmounted board
        // can't be measured, and the window is what the expanded view
        // would have given it.
        const boardWidth = findBoardElement()?.clientWidth || window.innerWidth
        const boardHeight =
            findBoardViewport()?.clientHeight || window.innerHeight
        const progress = toast({
            title: "Saving image…",
            description: keys.length > 1
                ? `Compositing ${keys.length} items`
                : "Compositing the image",
            duration: PROGRESS_TOAST_MS,
        })
        try {
            const background =
                getComputedStyle(document.body).backgroundColor || "#09090b"
            const stamp = timestampStamp()
            if (keys.length > 1) {
                const result = await composeBoardMosaic({
                    layout,
                    dbs,
                    boardWidth,
                    boardHeight,
                    targetWidth: size.kind === "px" ? size.px : boardWidth,
                    // "Window" is the selection at 1:1 with the screen, so
                    // it lays the board out at its real width; a preset is
                    // the saved file's own width.
                    widthMode: size.kind === "px" ? "output" : "layout",
                    seamless,
                    extent: "full",
                    only: new Set(keys),
                    proportional,
                    lossless,
                    background,
                })
                progress.dismiss()
                if (!result.ok) {
                    // Every selected key named a record that is gone — an
                    // edit landed while the menu was open. Not an error.
                    if (result.failure === "no-pins") {
                        toast({
                            title: "Nothing to save",
                            description: "Those items are no longer on the board.",
                            duration: 4000,
                        })
                        return
                    }
                    throw new Error(`mosaic geometry: ${result.failure}`)
                }
                const mosaic = result.mosaic
                const filename = `selection-${stamp}.${mosaic.extension}`
                downloadBlob(mosaic.blob, filename)
                const clamped = mosaic.clampedWidth !== null
                // A lossless mosaic is tens of megabytes and nothing else
                // on screen says so, so its size goes in the receipt.
                const saved = `${mosaic.width}×${mosaic.height}`
                    + (lossless ? `, ${prettyPrintBytes(mosaic.blob.size)}` : "")
                toast({
                    title: clamped ? "Image saved, scaled down" : "Image saved",
                    description: clamped
                        ? `${filename} — that size exceeds what browsers can`
                            + ` draw on one canvas, so it was saved at ${saved}.`
                        : `${filename} (${saved})`,
                    duration: clamped ? 6000 : 4000,
                })
                return
            }

            // Single item: locate its record on the live board. The cell is
            // needed only for the "Window" size, but finding the placement
            // is also how the crop and orientation are read.
            const key = keys[0]
            const parsed = parseBoard(layout)
            const grid = effectiveGrid(
                parsed.grid,
                gridScale(proportional, parsed.refWidth, boardWidth),
            )
            const placement = parsePlacements(
                parsed.records, grid, boardWidth, false, new Set([key]),
            )[0]
            if (!placement) {
                // The selection outlived the record it named (an edit landed
                // while the menu was open). Nothing to composite.
                progress.dismiss()
                toast({
                    title: "Nothing to save",
                    description: "That item is no longer on the board.",
                    duration: 4000,
                })
                return
            }
            // Metadata is fetched HERE rather than through a hook on the
            // selection: a hook would still be in flight for a selection
            // made a moment ago, and its two answers both change the
            // export — an item typed as an image loads the original file
            // (a video would download itself into an <img> that can never
            // decode it), and the indexed filename is what the saved file
            // is named after. The response is a cache hit in practice: the
            // pin itself already asked for it to render.
            const meta = await fetchClient.GET("/api/items/item", {
                params: {
                    query: { ...dbs, id: placement.sha256, id_type: "sha256" },
                },
            })
            const isImage = !!meta.data?.item?.type?.startsWith("image/")
            const name = meta.data?.files?.[0]?.path
                ? nameOfPath(meta.data.files[0].path)
                : { stem: "", ext: "" }
            const stem = name.stem || `item-${placement.sha256}`

            // An unedited image at original size has nothing to composite:
            // hand over the file itself rather than re-encoding it through a
            // canvas, which would only cost quality and metadata.
            if (
                size.kind === "native"
                && isImage
                && !placement.crop
                && isIdentityOrientation(placement.orient)
            ) {
                progress.dismiss()
                downloadURL(
                    originalFileURL(dbs, placement.sha256),
                    `${stem}-${stamp}${name.ext}`,
                )
                toast({
                    title: "Original file saved",
                    description: "This item has no crop or rotation, so the"
                        + " original file was saved untouched.",
                    duration: 4000,
                })
                return
            }

            const target: ItemImageTarget =
                size.kind === "px"
                    ? { kind: "width", px: size.px }
                    : size.kind === "window"
                        ? {
                            kind: "cell",
                            cellW: placement.width,
                            cellH: placement.height,
                        }
                        : { kind: "native" }
            const result = await composeItemImage({
                key,
                sha256: placement.sha256,
                dbs,
                crop: placement.crop,
                orient: placement.orient,
                target,
                original: isImage,
                lossless,
                background,
            })
            progress.dismiss()
            if (!result.ok) {
                if (result.failure === "no-source") {
                    toast({
                        title: "Nothing to save",
                        description: "This item's image could not be loaded —"
                            + " it may have left the index.",
                        duration: 5000,
                    })
                    return
                }
                throw new Error(`item image: ${result.failure}`)
            }
            const image = result.image
            const filename = `${stem}-${stamp}.${image.extension}`
            downloadBlob(image.blob, filename)
            toast({
                title: "Image saved",
                description: `${filename} (${image.width}×${image.height})`,
                duration: 4000,
            })
        } catch (err) {
            fail(progress, err)
        } finally {
            exportGuard.set(false)
        }
    }
    return { save, busy }
}

/**
 * The size rows plus the format toggles, for whichever of the two exports
 * the selection size selects. Both preferences persist in localStorage only
 * (see state/pinboardMosaicPrefs).
 */
export function SelectionExportMenuItems({
    kit,
    keys,
}: {
    kit: MenuKit
    keys: string[]
}) {
    const { save, busy } = useSelectionExport(keys)
    const [seamless, setSeamless] = usePinboardMosaicSeamless()
    const { Item, CheckboxItem, Separator } = kit
    const one = keys.length === 1
    return (
        <>
            {one && (
                <Item
                    disabled={busy}
                    title={"Save the file at its own resolution, cropped and"
                        + " oriented as the board shows it"}
                    onClick={() => void save({ kind: "native" })}
                >
                    Original Size
                </Item>
            )}
            <Item
                disabled={busy}
                title={one
                    ? "Save at the size this pin occupies on screen"
                    : "Save at the board's own width — the selection at 1:1"}
                onClick={() => void save({ kind: "window" })}
            >
                Window Size
            </Item>
            {EXPORT_PRESETS.map((w) => (
                <Item
                    key={w}
                    disabled={busy}
                    title={`Scale the result to ${w} px wide`}
                    onClick={() => void save({ kind: "px", px: w })}
                >
                    {`${w} px Wide`}
                </Item>
            ))}
            {/* The animated twin of whichever export this menu is: a mosaic of
                the selection, or — for a single pin that RESOLVES TO A SPAN (a
                playing video, or an animated image the server can decode) —
                the item itself as a video, cropped and oriented exactly as the
                board shows it. A stopped or genuinely still pin has no
                animated row: its frozen frame is a still image, and the rows
                above already save it. */}
            {one
                ? <AnimatedItemRows kit={kit} itemKey={keys[0] ?? null} />
                : <AnimatedMosaicRows kit={kit} keys={keys} />}
            <Separator />
            <SectionLabel kit={kit} />
            {/* Seamless is a mosaic's business only — one item has no
                gutters to close. It only closes the GUTTERS at that: an
                unselected item between two selected ones still leaves its
                hole, since the lattice is the board's (PNG is what makes
                that hole transparent rather than black). */}
            {!one && (
                <CheckboxItem
                    checked={seamless}
                    title="Tile the selected items edge to edge, with no gaps or padding"
                    onCheckedChange={(checked) => setSeamless(!!checked)}
                >
                    Seamless (No Gaps)
                </CheckboxItem>
            )}
            <LosslessMenuItem kit={kit} composite={!one} />
        </>
    )
}

/** The label the two exports share a menu row under. */
export function selectionExportLabel(count: number): string {
    return count === 1 ? "Save Image" : `Save Image (${count} items)`
}

/** The same rows as a submenu, for the toolbar dropdown and pin menus. */
export function SelectionExportSubmenu({
    kit,
    keys,
    inset = false,
}: {
    kit: MenuKit
    keys: string[]
    inset?: boolean
}) {
    const { Sub, SubTrigger, SubContent } = kit
    return (
        <Sub>
            <SubTrigger inset={inset}>{selectionExportLabel(keys.length)}</SubTrigger>
            <SubContent className="w-56">
                <SelectionExportMenuItems kit={kit} keys={keys} />
            </SubContent>
        </Sub>
    )
}
