import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { Square, SquareCheck } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { $api } from '@/lib/api'
import { useSelectedDBs } from '@/lib/state/database'

export function SelectButton({
    sha256, // This is usually just the prefix of the sha256 hash
}: {
    sha256: string,

}) {
    const dbs = useSelectedDBs()[0]
    const [selected, setSelected] = useItemSelection((state) => [state.getSelected(), state.setItem])
    // Match on the prefix of the sha256 hash
    const isSelected = useMemo(() => selected?.sha256.startsWith(sha256), [selected, sha256])
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: sha256,
                id_type: "sha256" // Supports prefix or full sha256 hash
            },
        }
    })
    const handlePinClick = () => {
        if (!isSelected && data) {
            if (data.files.length === 0) return
            const file = data.files[0]
            setSelected({
                file_id: file.id,
                path: file.path,
                sha256: data.item.sha256,
                item_id: data.item.id,
                last_modified: file.last_modified,
                type: data.item.type,
                width: data.item.width,
                height: data.item.height,
            })
        }
    }
    return <button
        title={
            isSelected ? "This image is selected" : "Select this image"
        }
        className={
            cn("hover:scale-105 absolute top-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300")
            // isSelected ? 'opacity-100' : 'opacity-0')
        }
        onClick={handlePinClick}
    >
        {isSelected ? (
            <SquareCheck className="w-6 h-6 text-gray-800 fill-gray-800" />

        ) : (
            <Square className="w-6 h-6 text-gray-800" />
        )}
    </button>
}