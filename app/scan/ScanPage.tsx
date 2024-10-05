"use client"

import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Group,
  InputObject,
  modelColumns,
  transformData,
} from "@/components/table/columns/models"
import React, { useEffect } from "react"
import { RowSelectionState } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { jobQueueColumns } from "@/components/table/columns/queue"
import { useToast } from "@/components/ui/use-toast"
import { SwitchDB } from "@/components/sidebar/options/switchDB"
import { Label } from "@/components/ui/label"
import { CreateNewDB } from "@/components/CreateDB"
import { components } from "@/lib/panoptikon"
import { FilterContainer } from "@/components/sidebar/base/FilterContainer"
import { SwitchFilter } from "@/components/sidebar/base/SwitchFilter"
import { ConfidenceFilter } from "@/components/sidebar/options/confidenceFilter"

export function ScanPage() {
  return (
    <div className="flex w-full h-screen">
      <div className={"p-4 mx-auto w-full"}>
        <ScrollArea className="overflow-y-auto">
          <div className="max-h-[100vh]">
            <SwitchDB />
            <Config />
            <CreateNewDB />
            <FolderLists />
            <GroupList />
            <JobQueue />
            <History />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export function History() {
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

export function FolderLists() {
  const [dbs] = useSelectedDBs()
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
    },
  )
  const queryClient = useQueryClient()

  // Local state for editable folder paths
  const [includedFolders, setIncludedFolders] = React.useState("")
  const [excludedFolders, setExcludedFolders] = React.useState("")

  // Update the local state whenever data is fetched
  useEffect(() => {
    if (data) {
      setIncludedFolders(data.included_folders.join("\n"))
      setExcludedFolders(data.excluded_folders.join("\n"))
    }
  }, [data])

  const { toast } = useToast()

  const update = $api.useMutation("put", "/api/jobs/folders", {
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
      })
      queryClient.invalidateQueries({
        queryKey: ["get", "/api/jobs/queue"],
      })
      toast({
        title: "Folder Update Queued",
        description:
          "The folders will be updated only after the job has been completed",
      })
    },
  })

  const rescan = $api.useMutation("post", "/api/jobs/folders/rescan", {
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
      })
      queryClient.invalidateQueries({
        queryKey: ["get", "/api/jobs/queue"],
      })
      toast({
        title: "Folder Rescan Queued",
        description: "The folders will be rescanned once the job is executed",
      })
    },
  })

  const updateFolders = async () => {
    update.mutate({
      params: {
        query: dbs,
      },
      body: {
        included_folders: includedFolders
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        excluded_folders: excludedFolders
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      },
    })
  }

  const rescanFolders = () => {
    rescan.mutate({
      params: {
        query: dbs,
      },
    })
  }

  return (
    <div className="rounded-lg border p-4 mb-4 mt-4">
      <Tabs className="" defaultValue="included">
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
        className="mt-4"
        variant="outline"
        onClick={() => updateFolders()}
      >
        Save And Scan New Paths
      </Button>
      <Button
        className="ml-4 mt-4"
        variant="outline"
        onClick={() => rescanFolders()}
      >
        Rescan All Paths
      </Button>
    </div>
  )
}

export function GroupList() {
  const { data, error, isError, refetch, isFetching } = $api.useQuery(
    "get",
    "/api/inference/metadata",
    {
      placeholderData: keepPreviousData,
    },
  )

  const groups = data ? transformData(data as any as InputObject) : []

  return groups.length > 0 ? (
    <Tabs defaultValue={groups[0].group_name} className="rounded-lg border p-4">
      <TabsList>
        {groups.map((group) => (
          <TabsTrigger key={group.group_name} value={group.group_name}>
            {group.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {groups.map((group) => (
        <GroupTab key={group.group_name} group={group} />
      ))}
    </Tabs>
  ) : null
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

  return (
    <TabsContent value={group.group_name}>
      <ScrollArea className="max-w-[95vw] whitespace-nowrap">
        <div className="p-4">
          <p className="text-wrap">{group.description}</p>
          <p className="text-wrap mt-3 text-gray-400">
            Select one or more models and click on "Run Job(s) for Selected" in
            order to schedule batch job(s) to generate index data for your files
            using the selected models.
            <br />
            "Delete Data From Selected" will remove the data previously
            generated by the selected models.
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
  )
}

export function JobQueue() {
  const { data, error, isError, refetch, isFetching } = $api.useQuery(
    "get",
    "/api/jobs/queue",
    {},
    {
      refetchInterval: 2500,
      placeholderData: keepPreviousData,
    },
  )
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const cancelJob = $api.useMutation("delete", "/api/jobs/queue", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["get", "/api/jobs/queue"],
      })
      toast({
        title: "Jobs Cancelled",
        description: "The selected jobs have been cancelled.",
      })
    },
  })
  const queue = data?.queue || []
  const [selected, setSelected] = React.useState<RowSelectionState>({})
  const selectedValues = queue.filter((_, index) => selected[index] === true)
  const cancelSelected = () => {
    cancelJob.mutate({
      params: {
        query: {
          queue_ids: selectedValues.map((job) => job.queue_id),
        },
      },
    })
  }

  return (
    <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
      <div className="flex flex-row items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-base">Job Queue</Label>
          <div className="text-gray-400">Queued and running jobs</div>
        </div>
      </div>
      <ScrollArea className="max-w-[95vw] whitespace-nowrap">
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
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
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

export function Config() {
  const [dbs] = useSelectedDBs()
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
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const changeSettings = $api.useMutation("put", "/api/jobs/config", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "get",
          "/api/jobs/config",
          {
            params: {
              query: dbs,
            },
          }
        ],
      })
      toast({
        title: "Settings Updated",
        description: "The changes have been applied",
      })
    },
  })

  const changeConfig = async (modifyConfig: (currentConfig: components["schemas"]["SystemConfig"]) => components["schemas"]["SystemConfig"]) => {
    // Refetch the latest configuration
    const latestConfig = await refetch()

    // Apply the change to the latest config
    if (latestConfig.data) {
      const newConfig = modifyConfig(latestConfig.data)
      changeSettings.mutate({ body: newConfig, params: { query: dbs } })
    }
  }

  return (
    <FilterContainer
      label="Scan Configuration"
      description="Change scan settings"
      storageKey="scanConfig"
    >
      {data ? <>
        <SwitchFilter
          label="Image Files"
          description="Include Image Files in the scan"
          value={data.scan_images}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            scan_images: value,
          }))}
        />
        <SwitchFilter
          label="Video Files"
          description="Include Video Files in the scan"
          value={data.scan_video}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            scan_video: value,
          }))}
        />
        <SwitchFilter
          label="Audio Files"
          description="Include Audio Files in the scan"
          value={data.scan_audio}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            scan_audio: value,
          }))}
        />
        <SwitchFilter
          label="PDF Files"
          description="Include PDF Files in the scan"
          value={data.scan_pdf}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            scan_pdf: value,
          }))}
        />
        <SwitchFilter
          label="HTML Files"
          description="Include HTML Files in the scan"
          value={data.scan_html}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            scan_html: value,
          }))}
        />
        <SwitchFilter
          label="Remove Unavailable Files"
          description="After a scan, remove files from db if no longer present on disk"
          value={data.remove_unavailable_files}
          onChange={(value) => changeConfig((currentConfig) => ({
            ...currentConfig,
            remove_unavailable_files: value,
          }))}
        />
      </> : null}
    </FilterContainer>
  )
}
export function useModelConfig(group: Group) {
  const [dbs] = useSelectedDBs()
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
  const config = data && data.job_settings !== undefined ? data.job_settings.filter((v) => (v.group_name === group.group_name) && !v.inference_id) : []
  return config.length > 0 ? config[0] : {
    group_name: group.group_name,
    default_batch_size: group.default_batch_size,
    default_threshold: group.default_threshold,
  }
}

export function ModelConfig(
  {
    modelConfig
  }: {
    modelConfig: components["schemas"]["JobSettings"],
  }
) {
  const [dbs] = useSelectedDBs()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const changeSettings = $api.useMutation("put", "/api/jobs/config", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "get",
          "/api/jobs/config",
          {
            params: {
              query: dbs,
            },
          }
        ],
      })
      toast({
        title: "Settings Updated",
        description: "The changes have been applied",
      })
    },
  })
  const { refetch } = $api.useQuery(
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

  const setValues = async (batchSize: number | null | undefined, threshold: number | null | undefined) => {
    const { data } = await refetch()
    if (!data) return
    const systemConfig = data
    // The config without the current group
    const job_settings = systemConfig.job_settings !== undefined ? systemConfig.job_settings.filter((v) => !((v.group_name === modelConfig.group_name) && !v.inference_id)) : []
    // Add the new config
    changeSettings.mutate({
      body: {
        ...systemConfig,
        job_settings: [
          ...job_settings,
          {
            group_name: modelConfig.group_name,
            default_batch_size: batchSize,
            default_threshold: threshold,
          },
        ],
      },
      params: { query: dbs }
    })
  }

  return (
    <>
      {modelConfig.default_batch_size !== undefined && modelConfig.default_batch_size !== null && <ConfidenceFilter
        label="Batch Size"
        description="Set to a lower value if you have little VRAM"
        min={1}
        max={256}
        step={1}
        confidence={modelConfig.default_batch_size}
        setConfidence={(value) => setValues(value, modelConfig.default_threshold)}
      />}
      {modelConfig.default_threshold !== undefined && modelConfig.default_threshold !== null && <ConfidenceFilter
        label="Confidence Threshold"
        description="Lower values will produce more data"
        min={0}
        max={1}
        confidence={modelConfig.default_threshold}
        setConfidence={(value) => setValues(modelConfig.default_batch_size, value)}
      />}
    </>
  )
}

