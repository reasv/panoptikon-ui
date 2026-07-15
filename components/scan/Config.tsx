import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { useToast } from "../ui/use-toast"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { FilterContainer } from "../sidebar/base/FilterContainer"
import { SwitchFilter } from "../sidebar/base/SwitchFilter"
import { Label } from "../ui/label"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { Save } from "lucide-react"
import React, { useEffect } from "react"
import { ScrollArea, ScrollBar } from "../ui/scroll-area"
import { DataTable } from "../table/dataTable"
import { RowSelectionState } from "@tanstack/react-table"
import { scheduleColumns } from "../table/columns/scheduled"
import { useSystemConfig } from "@/lib/useSystemConfig"

function formatRunTime(time: string | null | undefined) {
    if (!time) {
        return "—"
    }
    const parsed = new Date(time)
    return isNaN(parsed.getTime()) ? time : parsed.toLocaleString()
}

export function Config() {
    const [dbs] = useSelectedDBs()
    const { config: data, changeConfig } = useSystemConfig()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const { data: schedule } = $api.useQuery(
        "get",
        "/api/jobs/cronjob/schedule",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
            // next_run/last_run move on their own as the scheduler fires.
            refetchInterval: 30000,
        },
    )
    const [cronInputValue, setCronInputValue] = React.useState('')

    useEffect(() => {
        if (data) {
            setCronInputValue(data.cron_schedule)
        }
    }, [data])

    // The gateway's cron parser is the source of truth for validity; the
    // schedule endpoint reports it after every save.
    const cronInvalid = schedule !== undefined && !schedule.valid
    const changeCron = async () => {
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
    const cronjobRunMut = $api.useMutation(
        "post",
        "/api/jobs/cronjob/run",
        {
            onSuccess: () => {
                queryClient.invalidateQueries({
                    queryKey: ["get", "/api/jobs/queue"],
                })
                toast({
                    title: "Running Cron Job",
                    description: "The jobs in the cron schedule have been queued",
                })
            },
        })
    const runCronJob = async () => {
        cronjobRunMut.mutate({ params: { query: dbs } })
    }
    const guiKnownKeys = new Set([
        "remove_unavailable_files", "scan_images", "scan_video", "scan_audio", "scan_html", "scan_pdf",
        "enable_cron_job", "cron_schedule", "cron_jobs", "job_settings", "included_folders", "excluded_folders",
        "preload_embedding_models", "prewarm_embedding_models", "continuous_filescan", "job_filters", "filescan_filter",
    ])
    const tomlOnlyKeys = data
        ? Object.keys(data as Record<string, unknown>).filter((key) => !guiKnownKeys.has(key))
        : []
    const hasTomlOnlyConfiguration = Boolean(
        data && (data.job_filters.length > 0 || data.filescan_filter || tomlOnlyKeys.length > 0),
    )
    return (
        <FilterContainer
            label="Scan Configuration"
            description="Change scan settings"
            storageKey="scanConfig"
        >
            {data ? <>
                {hasTomlOnlyConfiguration && <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                    <p className="font-medium">This database also has advanced TOML configuration.</p>
                    <p className="mt-1 text-muted-foreground">These controls apply only the setting you change. Filters, comments, key order, and settings this UI does not understand are left in place.</p>
                    {tomlOnlyKeys.length > 0 && <p className="mt-2 font-mono text-xs text-muted-foreground">Additional keys: {tomlOnlyKeys.join(", ")}</p>}
                </div>}
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
                        label="Keep embedding models loaded"
                        description="Fastest searches, but keeps full model weights in system or GPU memory even while idle"
                        value={data.preload_embedding_models}
                        onChange={(value) => changeConfig((currentConfig) => ({
                            ...currentConfig,
                            preload_embedding_models: value,
                        }))}
                    />
                    <SwitchFilter
                        label="Prepare embedding worker code"
                        description="Reduces first-search import delay without loading model weights; still uses some system memory"
                        value={data.prewarm_embedding_models}
                        onChange={(value) => changeConfig((currentConfig) => ({
                            ...currentConfig,
                            prewarm_embedding_models: value,
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
                        {cronInvalid ? (
                            <div className="text-destructive text-sm mt-2">
                                The saved schedule string is invalid; automatic runs are disabled until it is fixed
                            </div>
                        ) : (
                            <div className="text-gray-400 text-sm mt-2">
                                Next run: {data.enable_cron_job ? formatRunTime(schedule?.next_run) : "—"}
                                {" · "}
                                Last run: {formatRunTime(schedule?.last_run)}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                    <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base">Cron Data Extraction Schedule</Label>
                            <div className="text-gray-400">These jobs will be run with the cronjob after the file scan</div>
                        </div>
                        <Button
                            title="Run the cron job immediately"
                            variant="outline"
                            onClick={runCronJob}
                        >Run Scheduled Jobs Now</Button>
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
