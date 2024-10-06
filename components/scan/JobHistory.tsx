import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import React from "react"

export function JobHistory() {
    return (
        <Tabs defaultValue="filescans" className="rounded-lg border p-4 mt-4">
            <TabsList>
                <TabsTrigger value="filescans">File Scan History</TabsTrigger>
                <TabsTrigger value="data">Data Extraction History</TabsTrigger>
            </TabsList>
            <TabsContent value="filescans">
                <FileScanHistory />
            </TabsContent>
            <TabsContent value="data">
                <DataExtractionHistory />
            </TabsContent>
        </Tabs>
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
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )

    return (
        <ScrollArea className="max-w-[95vw] whitespace-nowrap">
            <DataTable
                storageKey="dataextraction"
                data={data || []}
                columns={dataLogColumns}
                filterColumn="setter"
                filterPlaceholder="Search model..."
            />
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    )
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
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    return (
        <ScrollArea className="max-w-[95vw] whitespace-nowrap">
            <DataTable
                storageKey="filescan"
                data={data || []}
                columns={fileScanColumns}
                filterColumn="path"
                filterPlaceholder="Search path..."
            />
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    )
}
