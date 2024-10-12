import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { Square, SquareCheck } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { $api } from '@/lib/api'
import { useSelectedDBs } from '@/lib/state/database'

export function SelectButton({
    item_id,
}: {
    item_id: number,

}) {
    const dbs = useSelectedDBs()[0]
    const [selected, setSelected] = useItemSelection((state) => [state.getSelected(), state.setItem])
    const isSelected = useMemo(() => selected?.item_id === item_id, [selected, item_id])
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: item_id,
                id_type: "item_id"
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
                item_id,
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