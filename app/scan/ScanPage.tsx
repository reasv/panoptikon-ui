"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ScanPage() {
    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                <ScrollArea className="overflow-y-auto">
                    <div className='max-h-[100vh]'>
                        <Tabs defaultValue="filescans">
                            <TabsList className="grid w-full grid-cols-2">
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
                    </div>
                </ScrollArea>
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

    return <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <div className="p-4">
            <DataTable
                data={data || []}
                columns={dataLogColumns}
            />
        </div>
        <ScrollBar orientation="horizontal" />
    </ScrollArea>
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
    return <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <div className="p-4">
            <DataTable
                data={data || []}
                columns={fileScanColumns}
            />
        </div>
        <ScrollBar orientation="horizontal" />
    </ScrollArea>
}