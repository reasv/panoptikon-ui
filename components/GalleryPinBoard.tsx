import Image from 'next/image'
import { cn, getFullFileURL, getFullFileURLFromFileID, getThumbnailURL, getThumbnailURLFromFileID } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { useGalleryPins } from '@/lib/state/gallery';
import { PinButton } from './PinButton';

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
    const [pins, setPins] = useGalleryPins()
    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden ",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]" // Set height based on whether thumbnails
            )}
        >
            {pins.map((pin) => (
                <a
                    href={getFullFileURLFromFileID(pin, dbs)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 group"
                    onClick={(e) => e.preventDefault()}
                >
                    <Image
                        key={pin}
                        src={getThumbnailURLFromFileID(pin, dbs)}
                        alt={`File ID ${pin}`}
                        fill
                        className="object-contain"
                        unoptimized={true}
                    />
                    <PinButton file_id={pin} />
                </a>
            ))}
            <a
                href={fileURL}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 group"
                onClick={(e) => e.preventDefault()}
            >
                <Image
                    src={thumbnailURL}
                    alt={`${selectedItem.path}`}
                    fill
                    className="object-contain"
                    unoptimized={true}
                />
                <PinButton file_id={selectedItem.file_id} />
            </a>
        </div>
    )
}
