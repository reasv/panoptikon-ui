import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { useToast } from "../ui/use-toast"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { components } from "@/lib/panoptikon"
import { FilterContainer } from "../sidebar/base/FilterContainer"
import { SwitchFilter } from "../sidebar/base/SwitchFilter"
import { Label } from "../ui/label"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { Plus, Save } from "lucide-react"
import React, { useEffect } from "react"
import { ScrollArea, ScrollBar } from "../ui/scroll-area"
import { DataTable } from "../table/dataTable"
import { RowSelectionState } from "@tanstack/react-table"
import { scheduleColumns } from "../table/columns/scheduled"

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
    const [cronInputValue, setCronInputValue] = React.useState('')

    useEffect(() => {
        if (data) {
            setCronInputValue(data.cron_schedule)
        }
    }, [data])

    const changeConfig = async (modifyConfig: (currentConfig: components["schemas"]["SystemConfig"]) => components["schemas"]["SystemConfig"]) => {
        // Refetch the latest configuration
        const latestConfig = await refetch()

        // Apply the change to the latest config
        if (latestConfig.data) {
            const newConfig = modifyConfig(latestConfig.data)
            changeSettings.mutate({ body: newConfig, params: { query: dbs } })
        }
    }
    const validateCron = (cron: string) => {
        // Regular expression to validate a cron string, including step values and ranges
        const cronRegex = /^(\*(\/[1-9]\d*)?|([0-5]?\d)(\/[1-9]\d*)?|([0-5]?\d)-([0-5]?\d)(\/[1-9]\d*)?) (\*(\/[1-9]\d*)?|([01]?\d|2[0-3])(\/[1-9]\d*)?|([01]?\d|2[0-3])-([01]?\d|2[0-3])(\/[1-9]\d*)?) (\*(\/[1-9]\d*)?|([01]?\d|3[01])(\/[1-9]\d*)?|([01]?\d|3[01])-([01]?\d|3[01])(\/[1-9]\d*)?) (\*(\/[1-9]\d*)?|(0?[1-9]|1[0-2])(\/[1-9]\d*)?|(0?[1-9]|1[0-2])-(0?[1-9]|1[0-2])(\/[1-9]\d*)?) (\*(\/[1-9]\d*)?|([0-6])(\/[1-9]\d*)?|([0-6])-([0-6])(\/[1-9]\d*)?)$/;

        if (!cronRegex.test(cron)) {
            toast({
                title: "Invalid cron string",
                description: "Follow the format 'min hr day month weekday' (e.g., '0 3 * * *')",
                variant: "destructive"
            });
            return false;
        }

        return true;
    };
    const changeCron = async () => {
        if (!validateCron(cronInputValue)) {
            if (data) {
                setCronInputValue(data.cron_schedule)
            }
            return
        }
        changeConfig((currentConfig) => ({
            ...currentConfig,
            cron_schedule: cronInputValue,
        }))
    }
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const cronJobs = data?.cron_jobs || []
    const selectedValues = data?.cron_jobs?.filter((_, index) => selected[index] === true) || []
    const cancelSelected = () => {
        changeConfig((currentConfig) => ({
            ...currentConfig,
            cron_jobs: (currentConfig?.cron_jobs || []).filter(job => {
                return !selectedValues.some(selectedJob => selectedJob.inference_id === job.inference_id)
            }),
        }))
        setSelected({})
    }
    return (
        <FilterContainer
            label="Scan Configuration"
            description="Change scan settings"
            storageKey="scanConfig"
        >
            {data ? <>
                <div className='grid gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 4xl:grid-cols-4'>
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
                    <SwitchFilter
                        label="Enable Cron Job"
                        description="Enable the cron job to run the file scan and selected extraction jobs at regular intervals"
                        value={data.enable_cron_job}
                        onChange={(value) => changeConfig((currentConfig) => ({
                            ...currentConfig,
                            enable_cron_job: value,
                        }))}
                    />
                    <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                        <div className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">
                                    Cron String
                                </Label>
                                <div className="text-gray-400">
                                    Cron Schedule String
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                            <Input
                                minLength={3}
                                maxLength={16}
                                onChange={(e) => setCronInputValue(e.target.value)}
                                value={cronInputValue}
                                placeholder="Type a valid cron string like '0 3 * * *'" />
                            <Button title="Save Cron String" onClick={changeCron} variant="ghost" size="icon">
                                <Save className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                    <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base">Cron Data Extraction Schedule</Label>
                            <div className="text-gray-400">These jobs will be run with the cronjob after the file scan</div>
                        </div>
                    </div>
                    <ScrollArea className="max-w-[97vw] whitespace-nowrap">
                        <DataTable
                            setRowSelection={setSelected}
                            rowSelection={selected}
                            storageKey="cronJobs"
                            data={cronJobs}
                            columns={scheduleColumns}
                            header={
                                <Button
                                    disabled={selectedValues.length === 0}
                                    className="ml-4"
                                    variant="destructive"
                                    onClick={() => cancelSelected()}
                                >
                                    Remove Selected
                                </Button>
                            }
                        />
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                </div>
            </> : null}
        </FilterContainer>
    )
}