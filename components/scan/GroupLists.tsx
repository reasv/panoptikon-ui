import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { DataTable } from "@/components/table/dataTable"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Group,
    InputObject,
    modelColumns,
    transformData,
} from "@/components/table/columns/models"
import React from "react"
import { RowSelectionState } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { ModelConfig, useCronJobSchedule, useModelConfig } from "./ModelConfig"
import { useExtractionGroupTabs } from "@/lib/state/ScanTabs"
import { splitByFirstSlash } from "../SearchTypeSelector"
import { dataSettersColumns } from "../table/columns/dataSetters"

export function GroupList() {
    const { data } = $api.useQuery(
        "get",
        "/api/inference/metadata",
        {
            placeholderData: keepPreviousData,
        },
    )

    const groups = data ? transformData(data as any as InputObject) : []
    return groups.length > 0 ? (<GroupListInnner groups={groups} />) : null
}

function GroupListInnner(
    { groups }: { groups: Group[] }
) {
    const groupNames = groups.map((group) => group.group_name)
    const [selectedTab, setSelectedTab] = useExtractionGroupTabs()
    const currentTab = (selectedTab && (selectedTab === "datasetters" || groupNames.includes(selectedTab))) ? selectedTab : groups[0].group_name
    return <Tabs
        value={currentTab}
        onValueChange={(value) => setSelectedTab(value)}
        defaultValue={groups[0].group_name}
        className="rounded-lg border p-4"
    >
        <TabsList>
            {groups.map((group) => (
                <TabsTrigger key={group.group_name} value={group.group_name}>
                    {group.name}
                </TabsTrigger>
            ))}
            <TabsTrigger key={"ds"} value={"datasetters"}>
                With Existing Data
            </TabsTrigger>
        </TabsList>
        {groups.map((group) => (
            <GroupTab key={group.group_name} group={group} />
        ))}
        <ExistingDataTab key={"ds"} groups={groups} />
    </Tabs>
}

export function GroupTab({ group }: { group: Group }) {
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = group.inference_ids.filter(
        (_, index) => selected[index] === true,
    )
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [dbs] = useSelectedDBs()
    const modelConfig = useModelConfig(group)
    const runJob = $api.useMutation("post", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Jobs Scheduled",
                description: "The selected jobs have been scheduled.",
            })
            setSelected({})
        },
    })
    const deleteData = $api.useMutation("delete", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Data Deleted",
                description: "The data deletion has been scheduled",
            })
            setSelected({})
        },
    })
    const runSelected = () => {
        runJob.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map(
                        (model) => `${group.group_name}/${model.inference_id}`,
                    ),
                    batch_size: modelConfig.default_batch_size,
                    threshold: modelConfig.default_threshold,
                },
            },
        })
    }
    const deleteSelected = () => {
        deleteData.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map(
                        (model) => `${group.group_name}/${model.inference_id}`,
                    ),
                },
            },
        })
    }
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/config",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        },
    )
    const addToSchedule = useCronJobSchedule()
    const addToCronSchedule = () => {
        const batchSize = modelConfig.default_batch_size || undefined
        const threshold = modelConfig.default_threshold === null ? undefined : modelConfig.default_threshold
        addToSchedule(selectedValues.map((model) => `${group.group_name}/${model.inference_id}`), batchSize, threshold)
        setSelected({})
    }
    return (
        <TabsContent value={group.group_name}>
            <ScrollArea className="max-w-[97vw] whitespace-nowrap">
                <div className="p-4">
                    <p className="text-wrap">{group.description}</p>
                    <p className="text-wrap mt-3 text-gray-400">
                        Select one or more models and click on "Run Job(s) for Selected" in
                        order to schedule batch job(s) to generate index data for your files
                        using the selected models.
                        <br />
                        "Delete Data From Selected" will remove the data previously
                        generated by the selected models.
                        <br />
                        "Add to Cron Schedule" will add the model to the list of models to be
                        run on a schedule (enable in the scan settings).
                    </p>
                    {data && <ModelConfig
                        modelConfig={modelConfig}
                    />}
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
                                    variant="outline"
                                    onClick={() => runSelected()}
                                >
                                    Run Job(s) for Selected
                                </Button>
                                <Button
                                    disabled={selectedValues.length === 0}
                                    className="ml-4"
                                    variant="destructive"
                                    onClick={() => deleteSelected()}
                                >
                                    Delete Data From Selected
                                </Button>
                                <Button
                                    disabled={selectedValues.length === 0}
                                    className="ml-4 mr-4"
                                    variant="outline"
                                    onClick={() => addToCronSchedule()}
                                >
                                    Add to Cron Schedule
                                </Button>
                            </>
                        }
                    />
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </TabsContent>
    )
}

export function ExistingDataTab({ groups }: { groups: Group[] }) {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [dbs] = useSelectedDBs()
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const setterData = $api.useQuery("get", "/api/jobs/data/setters/total",
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
    const setters = setterData.data?.total_counts || []
    const selectedValues = setters.filter(
        (_, index) => selected[index] === true,
    )
    const jobConfigQuery = $api.useQuery(
        "get",
        "/api/jobs/config",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        },
    )
    const jobConfigs = jobConfigQuery.data?.job_settings || []

    const setterList = setters.map(([setter, count]) => {
        const [group_name, inference_id] = splitByFirstSlash(setter)
        const groupConfig = jobConfigs.find(
            (config) => group_name === config.group_name,
        )
        const specificConfig = jobConfigs.find(
            (model) => model.inference_id === setter,
        )
        const groupData = groups.find(
            (group) => group.group_name === group_name,
        )
        const description = groupData?.inference_ids.find(
            (model) => model.inference_id === inference_id,
        )?.description
        return {
            setter,
            count,
            description,
            batch_size: specificConfig?.default_batch_size || groupConfig?.default_batch_size || groupData?.default_batch_size || 1,
            threshold: specificConfig?.default_threshold || groupConfig?.default_threshold || groupData?.default_threshold || undefined,
        }
    })

    const runJob = $api.useMutation("post", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Jobs Scheduled",
                description: "The selected jobs have been scheduled.",
            })
            setSelected({})
        },
    })
    const deleteData = $api.useMutation("delete", "/api/jobs/data/extraction", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Data Deleted",
                description: "The data deletion has been scheduled",
            })
            setSelected({})
        },
    })
    const runSelected = () => {
        runJob.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map(
                        ([setter, count]) => setter,
                    )
                },
            },
        })
    }
    const deleteSelected = () => {
        deleteData.mutate({
            params: {
                query: {
                    ...dbs,
                    inference_ids: selectedValues.map(
                        ([setter, count]) => setter,
                    ),
                },
            },
        })
    }
    return (
        <TabsContent value={"datasetters"}>
            <ScrollArea className="max-w-[97vw] whitespace-nowrap">
                <div className="p-4">
                    <p className="text-wrap">
                        These are the models that have previously been run on your data and have
                        generated index data currently stored in the database.
                        You can use this list to quickly re-run jobs or delete data.
                        Configure the batch size and threshold for each model in the individual group tabs.
                    </p>
                    <p className="text-wrap mt-3 text-gray-400">
                        Select one or more models and click on "Run Job(s) for Selected" in
                        order to schedule batch job(s) to generate index data for your files
                        using the selected models.
                        <br />
                        "Delete Data From Selected" will remove the data previously
                        generated by the selected models.
                    </p>
                    <DataTable
                        setRowSelection={setSelected}
                        rowSelection={selected}
                        storageKey={"dataSettersTable"}
                        data={setterList}
                        columns={dataSettersColumns}
                        filterColumn="description"
                        filterPlaceholder="Search description..."
                        header={
                            <>
                                <Button
                                    disabled={selectedValues.length === 0}
                                    variant="outline"
                                    onClick={() => runSelected()}
                                >
                                    Run Job(s) for Selected
                                </Button>
                                <Button
                                    disabled={selectedValues.length === 0}
                                    className="ml-4"
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
    )
}
