"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InputObject, modelColumns, transformData } from "@/components/table/columns/models"

export function ScanPage() {
    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                <ScrollArea className="overflow-y-auto">
                    <div className='max-h-[100vh]'>
                        <GroupList />
                        <Tabs defaultValue="filescans">
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
                    </div>
                </ScrollArea>
            </div>
        </div>
    )
}

export function GroupList() {
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/inference/metadata",
        {
            placeholderData: keepPreviousData,
        }
    )
    const groups = data ? transformData(data as any as InputObject) : []

    return groups.length > 0 ? <Tabs defaultValue={groups[0].group_name}>
        <TabsList>
            {groups.map(
                (group) => (
                    <TabsTrigger value={group.group_name}>{group.name}</TabsTrigger>
                )
            )}
        </TabsList>
        {groups.map((group) => (
            <TabsContent value={group.group_name}>
                <ScrollArea className="max-w-[95vw] whitespace-nowrap">
                    <div className="p-4">
                        <DataTable
                            data={group.inference_ids || []}
                            columns={modelColumns}
                            filterColumn="description"
                            filterPlaceholder="Search description..."
                        />
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </TabsContent>
        ))}
    </Tabs> : null
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
                filterColumn="setter"
                filterPlaceholder="Search model..."
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
                filterColumn="path"
                filterPlaceholder="Search path..."
            />
        </div>
        <ScrollBar orientation="horizontal" />
    </ScrollArea>
}