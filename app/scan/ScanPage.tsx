"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"

export function ScanPage() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/folders/history",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )
    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                {<DataTable data={data || []} columns={fileScanColumns} />}
            </div>
        </div>
    )
}