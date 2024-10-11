import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { Square, SquareCheck } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { $api } from '@/lib/api'
import { useSelectedDBs } from '@/lib/state/database'

export function SelectButton({
    file_id,
}: {
    file_id: number,

}) {
    const dbs = useSelectedDBs()[0]
    const [selected, setSelected] = useItemSelection((state) => [state.getSelected(), state.setItem])
    const isSelected = useMemo(() => selected?.file_id === file_id, [selected, file_id])
    const { data } = $api.useQuery("get", "/api/items/from-file-id/{file_id}", {
        params: {
            query: dbs,
            path: {
                file_id
            }
        }
    })
    const handlePinClick = () => {
        if (!isSelected && data) {
            if (data.files.length === 0) return
            const file = data.files.find((file) => file.id === file_id) || data.files[0]
            setSelected({
                file_id,
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