"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"

export function ScanPage() {

    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                {/* <FileScanHistory /> */}
                <DataExtractionHistory />
            </div>
        </div>
    )
}

export function DataExtractionHistory() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/data/history",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )
    return <DataTable
        data={data || []}
        columns={dataLogColumns}
    />
}

export function FileScanHistory() {
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
    return <DataTable
        data={data || []}
        columns={fileScanColumns}
    />
}