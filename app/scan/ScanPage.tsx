"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Group, InputObject, modelColumns, transformData } from "@/components/table/columns/models"
import React, { useEffect } from "react"
import { RowSelectionState } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { jobQueueColumns } from "@/components/table/columns/queue"
import { useToast } from "@/components/ui/use-toast"

export function ScanPage() {
    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                <ScrollArea className="overflow-y-auto">
                    <div className='max-h-[100vh]'>
                        <FolderLists />
                        <GroupList />
                        <JobQueue />
                        <Tabs defaultValue="filescans">
                            <TabsList>
                                <TabsTrigger
                                    value="filescans"
                                >File Scan History</TabsTrigger>
                                <TabsTrigger
                                    value="data"
                                >Data Extraction History</TabsTrigger>
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

export function FolderLists() {
    const [dbs] = useSelectedDBs();
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/folders",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    );
    const queryClient = useQueryClient();

    // Local state for editable folder paths
    const [includedFolders, setIncludedFolders] = React.useState("");
    const [excludedFolders, setExcludedFolders] = React.useState("");

    // Update the local state whenever data is fetched
    useEffect(() => {
        if (data) {
            setIncludedFolders(data.included_folders.join("\n"));
            setExcludedFolders(data.excluded_folders.join("\n"));
        }
    }, [data]);

    const update = $api.useMutation(
        "put",
        "/api/jobs/folders",
        {
            onSuccess: () => {
                queryClient.invalidateQueries({
                    queryKey: [
                        "get",
                        "/api/jobs/folders",
                        {
                            params: {
                                query: dbs,
                            },
                        },
                    ],
                });
                queryClient.invalidateQueries({
                    queryKey: [
                        "get",
                        "/api/jobs/queue",
                    ],
                });
            },
        }
    );

    const rescan = $api.useMutation(
        "post",
        "/api/jobs/folders/rescan",
        {
            onSuccess: () => {
                queryClient.invalidateQueries({
                    queryKey: [
                        "get",
                        "/api/jobs/folders",
                        {
                            params: {
                                query: dbs,
                            },
                        },
                    ],
                });
                queryClient.invalidateQueries({
                    queryKey: [
                        "get",
                        "/api/jobs/queue",
                    ],
                });
            },
        }
    );

    const updateFolders = async () => {
        update.mutate({
            params: {
                query: dbs,
            },
            body: {
                included_folders: includedFolders.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
                excluded_folders: excludedFolders.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
            },
        });
    };

    const rescanFolders = () => {
        rescan.mutate({
            params: {
                query: dbs,
            },
        });
    };

    return (
        <>
            <Tabs className="mb-4" defaultValue="included">
                <TabsList>
                    <TabsTrigger value="included">Included Folder Paths</TabsTrigger>
                    <TabsTrigger value="excluded">Excluded Folder Paths</TabsTrigger>
                </TabsList>
                <TabsContent value="included">
                    <Textarea
                        className="min-h-40"
                        placeholder="One path per line. These folders will be scanned for files."
                        value={includedFolders}
                        onChange={(e) => setIncludedFolders(e.target.value)}
                    />
                </TabsContent>
                <TabsContent value="excluded">
                    <Textarea
                        className="min-h-40"
                        placeholder="One path per line. These folders will be excluded from the scan."
                        value={excludedFolders}
                        onChange={(e) => setExcludedFolders(e.target.value)}
                    />
                </TabsContent>
            </Tabs>
            <Button
                className="ml-4 mb-4"
                variant="outline"
                onClick={() => updateFolders()}
            >
                Save And Scan New Paths
            </Button>
            <Button
                className="ml-4 mb-4"
                variant="outline"
                onClick={() => rescanFolders()}
            >
                Rescan All Paths
            </Button>
        </>
    );
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

    return groups.length > 0 ? (
        <Tabs
            defaultValue={groups[0].group_name}
        >
            <TabsList>
                {groups.map(
                    (group) => (
                        <TabsTrigger
                            key={group.group_name}
                            value={group.group_name}
                        >{group.name}</TabsTrigger>
                    )
                )}
            </TabsList>
            {groups.map((group) => (
                <GroupTab
                    key={group.group_name}
                    group={group}
                />
            ))}
        </Tabs>
    ) : null
}

export function GroupTab({ group }: { group: Group }) {
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = group.inference_ids.filter((_, index) => selected[index] === true)
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [dbs] = useSelectedDBs()
    const runJob = $api.useMutation("post", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/queue",
                ],
            })
            toast({
                title: "Jobs Scheduled",
                description: "The selected jobs have been scheduled.",
            })
        },
    })
    const deleteData = $api.useMutation("delete", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/queue",
                ],
            })
            toast({
                title: "Data Deleted",
                description: "The data deletion has been scheduled",
            })
        },
    })
    const runSelected = () => {
        runJob.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map((model) => model.inference_id),
                },
            },
        });
    }
    const deleteSelected = () => {
        deleteData.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map((model) => model.inference_id),
                },
            },
        });
    }
    return <TabsContent
        value={group.group_name}
    >
        <ScrollArea className="max-w-[95vw] whitespace-nowrap">
            <div className="p-4">
                <p className="text-wrap">
                    {group.description}
                </p>
                <p className="text-wrap mt-3">
                    Select one or more models and click on "Run Job(s) for Selected"
                    in order to schedule batch job(s) to generate index data for your files
                    using the selected models.<br />
                    "Delete Data From Selected" will remove the data previously
                    generated by the selected models.
                </p>
                <DataTable
                    setRowSelection={setSelected}
                    rowSelection={selected}
                    storageKey={"groupTable"}
                    data={group.inference_ids || []}
                    columns={modelColumns}
                    filterColumn="description"
                    filterPlaceholder="Search description..."
                    header={
                        <>
                            <Button
                                disabled={selectedValues.length === 0}
                                className="ml-4"
                                variant="outline"
                                onClick={() => runSelected()}
                            >
                                Run Job(s) for Selected
                            </Button>
                            <Button
                                disabled={selectedValues.length === 0}
                                className="ml-4 mr-4"
                                variant="destructive"
                                onClick={() => deleteSelected()}
                            >
                                Delete Data From Selected
                            </Button>
                        </>
                    }
                />
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    </TabsContent>
}

export function JobQueue() {
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/queue",
        {},
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        }
    )
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const cancelJob = $api.useMutation("delete", "/api/jobs/queue",
        {
            onSuccess: () => {
                queryClient.invalidateQueries({
                    queryKey: [
                        "get",
                        "/api/jobs/queue",
                    ],
                })
                toast({
                    title: "Jobs Cancelled",
                    description: "The selected jobs have been cancelled.",
                })
            }
        }
    )
    const queue = data?.queue || []
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = queue.filter((_, index) => selected[index] === true)
    const cancelSelected = () => {
        cancelJob.mutate({
            params: {
                query: {
                    queue_ids: selectedValues.map((job) => job.queue_id),
                }
            },
        })
    }
    return <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <h1 className="text-wrap mt-3">
            Job Queue
        </h1>
        <div className="p-4">
            <DataTable
                setRowSelection={setSelected}
                rowSelection={selected}
                storageKey="jobQueue"
                data={queue}
                columns={jobQueueColumns}
                header={
                    <Button
                        disabled={selectedValues.length === 0}
                        className="ml-4"
                        variant="destructive"
                        onClick={() => cancelSelected()}
                    >
                        Cancel Selected
                    </Button>
                }
            />
        </div>
        <ScrollBar orientation="horizontal" />
    </ScrollArea>
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
        }
    )

    return <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <div className="p-4">
            <DataTable
                storageKey="dataextraction"
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
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        }
    )
    return <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <div className="p-4">
            <DataTable
                storageKey="filescan"
                data={data || []}
                columns={fileScanColumns}
                filterColumn="path"
                filterPlaceholder="Search path..."
            />
        </div>
        <ScrollBar orientation="horizontal" />
    </ScrollArea>
}