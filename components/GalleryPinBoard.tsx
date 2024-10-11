import Image from 'next/image'
import { cn, getFullFileURL, getFullFileURLFromFileID, getThumbnailURL, getThumbnailURLFromFileID } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";

export function PinBoard(
    {
        selectedItem,
        thumbnailsOpen,
    }: {
        selectedItem: SearchResult,
        thumbnailsOpen: boolean
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const thumbnailURL = getThumbnailURLFromFileID(selectedItem.file_id, dbs)
    const fileURL = getFullFileURLFromFileID(selectedItem.file_id, dbs)

    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden ",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]" // Set height based on whether thumbnails
            )}
        >
            <a
                href={fileURL}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0"
                onClick={(e) => e.preventDefault()}
            >
                <Image
                    src={thumbnailURL}
                    alt={`${selectedItem.path}`}
                    fill
                    className="object-contain"
                    unoptimized={true}
                />
            </a>
        </div>
    )
}
