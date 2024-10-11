import Image from 'next/image'
import { cn, getFullFileURLFromFileID, getThumbnailURLFromFileID } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryPins } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useMemo } from 'react'
import { Responsive, WidthProvider } from "react-grid-layout"
const ResponsiveGridLayout = WidthProvider(Responsive)

export function PinBoard(
    {
        selectedItem,
        thumbnailsOpen,
    }: {
        selectedItem: SearchResult,
        thumbnailsOpen: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    const [pins, setPins] = useGalleryPins()
    const pinnedFiles: [number, string, string][] = useMemo(() => {
        const allPins: number[] = [...pins, ...(pins.includes(selectedItem.file_id) ? [] : [selectedItem.file_id])]
        return allPins.map((file_id) => [
            file_id,
            getThumbnailURLFromFileID(file_id, dbs),
            getFullFileURLFromFileID(file_id, dbs)
        ])
    }, [pins, selectedItem])

    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden ",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]" // Set height based on whether thumbnails
            )}
        >
            {pinnedFiles.map(([file_id, thumbnail, file]) => (
                <a
                    key={file_id}
                    href={file}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 group"
                    onClick={(e) => e.preventDefault()}
                >
                    <Image
                        src={thumbnail}
                        alt={`File ID ${file_id}`}
                        fill
                        className="object-contain"
                        unoptimized={true}
                    />
                    <PinButton file_id={file_id} />
                </a>
            ))}

        </div>
    )
}
