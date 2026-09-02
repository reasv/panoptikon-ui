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
import { useClientConfig } from "@/lib/useClientConfig"
import { MultiBoxResponsive } from "../multiCombobox"

// The formats the scan is ALLOWED to write renditions in
// (docs/thumbnail-format-implementation.md R5). A CONSTRAINT on the
// per-content-class policy, never the policy itself: with `webp` dropped every
// WebP verdict becomes JPEG (alpha flattened, as before the format work), and
// with `jpeg` dropped every JPEG verdict becomes WebP — the storage-constrained
// deployment, which knowingly pays the slower decode the grid is bound by.
const THUMBNAIL_FORMAT_OPTIONS = [
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WebP" },
]

// What the server applies for a database that has never written the key, and
// therefore what the control must show for one. The server reads an EMPTY list
// as this same default (with a warning) rather than rejecting the save, so the
// only thing the UI owes it is not to OFFER an empty selection.
const THUMBNAIL_FORMATS_DEFAULT = ["jpeg", "webp"]

// Is this stored entry one of the two formats this control knows how to draw?
function isKnownThumbnailFormat(entry: unknown): entry is string {
    return typeof entry === "string"
        && THUMBNAIL_FORMAT_OPTIONS.some((option) => option.value === entry)
}

// Read defensively off the config object rather than through the generated
// schema type: the per-DB config carries an index signature for keys the UI
// does not model, so this one types as `unknown` until the OpenAPI document is
// regenerated — and a config written by a Server that predates the key is
// genuinely absent, not merely untyped.
//
// WHAT THE CONTROL SHOWS AS CHECKED: the KNOWN entries of the stored list, and
// nothing else. The default stands in for exactly the two cases where the
// server itself applies the default — the key absent (or not a list at all)
// and the list empty — and for no other. In particular a stored `["avif"]`
// shows NEITHER box checked, which is the truth about what this UI can see;
// showing the default there would be a claim about the stored value that the
// very next toggle would then make true by overwriting it (see
// `mergeThumbnailFormats`, which is why it no longer can).
function effectiveThumbnailFormats(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) return THUMBNAIL_FORMATS_DEFAULT
    return value.filter(isKnownThumbnailFormat)
}

// WHAT A TOGGLE WRITES. The settings page round-trips the WHOLE config object
// on every save, so anything this control drops from the list is deleted from
// the user's database — and the list may legitimately hold values this build
// of the UI does not model (a newer Server's format, a hand-edited TOML).
//
// So the write is a MERGE, not a replacement: every stored entry the control
// cannot draw is carried through in its stored position untouched, every known
// entry survives iff it is still selected, and newly selected ones are
// appended. A UI that only knows two formats can therefore be used on a
// database that stores three without silently discarding the third.
function mergeThumbnailFormats(value: unknown, selected: string[]): unknown[] {
    const stored: unknown[] = Array.isArray(value) ? value : []
    const kept = stored.filter((entry) =>
        !isKnownThumbnailFormat(entry) || selected.includes(entry))
    const added = selected.filter((format) => !kept.includes(format))
    return [...kept, ...added]
}

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
    const clientConfig = useClientConfig()
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
    const maintenanceMut = $api.useMutation(
        "post",
        "/api/jobs/maintenance",
        {
            onSuccess: () => {
                queryClient.invalidateQueries({
                    queryKey: ["get", "/api/jobs/queue"],
                })
                toast({
                    title: "Database Maintenance",
                    description: "The maintenance job has been queued",
                })
            },
            // The gateway explains itself in `detail` (a 409 says a pass is
            // already running); transport failures have no body.
            onError: (error) => {
                const detail = (error as { detail?: string } | null)?.detail
                toast({
                    title: "Maintenance Failed",
                    description: detail || "The server rejected the request",
                    variant: "destructive",
                })
            },
        })
    const runMaintenance = () => {
        maintenanceMut.mutate({ params: { query: dbs } })
    }
    const guiKnownKeys = new Set([
        "remove_unavailable_files", "scan_images", "scan_video", "scan_audio", "scan_html", "scan_pdf",
        "detect_outros",
        "enable_cron_job", "cron_schedule", "cron_jobs", "job_settings", "included_folders", "excluded_folders",
        "preload_embedding_models", "prewarm_embedding_models", "continuous_filescan", "job_filters", "filescan_filter",
        "vector_quants", "thumbnail_formats",
    ])
    const thumbnailFormats = effectiveThumbnailFormats(data?.thumbnail_formats)
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
                        description={<>
                            <p>Include HTML Files in the scan</p>
                            {clientConfig.data?.desktopManaged === true && data.scan_html &&
                                <p className="mt-2 text-amber-700 dark:text-amber-300" role="note">
                                    HTML indexing requires an installed Chromium-based browser such as Chrome, Chromium, Brave, or Edge. Files are skipped until a compatible browser is available.
                                </p>}
                        </>}
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
                        label="TikTok Detection"
                        description="Detect TikTok end cards so thumbnails, AI and video playback skip them. Turning this off also stops serving already-detected end cards, which disables outro skip in the player"
                        value={data.detect_outros}
                        onChange={(value) => changeConfig((currentConfig) => ({
                            ...currentConfig,
                            detect_outros: value,
                        }))}
                    />
                    <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                        <div className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Thumbnail Formats</Label>
                                <div className="text-gray-400">
                                    Which image formats the scan may store thumbnails in
                                </div>
                            </div>
                            <MultiBoxResponsive
                                options={THUMBNAIL_FORMAT_OPTIONS}
                                currentValues={thumbnailFormats}
                                placeholder="Formats"
                                maxDisplayed={2}
                                // AT LEAST ONE, ALWAYS. The server reads an empty
                                // list as the default rather than rejecting the
                                // save, so this is not a validation gate — it is
                                // the control declining to offer a selection whose
                                // meaning ("all of them, actually") contradicts
                                // what it would be showing.
                                //
                                // The refusal is measured against the MERGED list,
                                // not against the checkboxes: a database storing a
                                // format this build does not model still has one
                                // after both boxes are cleared, so refusing there
                                // would be refusing something that is not empty.
                                //
                                // AND IT SAYS SO. A control that silently ignores
                                // a click reads as broken — the user clears the
                                // last box, the box stays checked, and nothing
                                // explains why. The toast is this page's own idiom
                                // for "the thing you asked for did not happen"
                                // (see the maintenance and cron mutations), and
                                // the help text below states the rule before the
                                // user has to meet it.
                                onSelectionChange={(values) => {
                                    const next = mergeThumbnailFormats(
                                        data?.thumbnail_formats, values)
                                    if (next.length === 0) {
                                        toast({
                                            title: "Thumbnail Formats",
                                            description: "At least one format must stay selected — thumbnails have to be stored in something.",
                                        })
                                        return
                                    }
                                    changeConfig((currentConfig) => ({
                                        ...currentConfig,
                                        thumbnail_formats: next,
                                    }))
                                }}
                            />
                        </div>
                        <div className="text-gray-400 text-sm mt-2">
                            <p>
                                By default grid thumbnails are JPEG, which decodes
                                more than twice as fast per megapixel and is what a
                                screenful of cells is bound by. Full-size gallery
                                renditions of lossless originals (PNG, BMP, TIFF)
                                and every rendition of an image with transparent
                                pixels are WebP, which is far smaller at the same
                                quality and is the only one of the two with an
                                alpha channel.
                            </p>
                            <p className="mt-2">
                                Deselecting a format does not delete anything: the
                                renditions stored in the wrong format are rewritten
                                over the next scan, one decode per image. The
                                database file itself only shrinks after a
                                Database Maintenance pass reclaims the freed space.
                            </p>
                            <p className="mt-2">
                                At least one format must stay selected.
                            </p>
                        </div>
                    </div>
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
                    <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                        <div className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Database Maintenance</Label>
                                <div className="text-gray-400">Recount tags, refresh query statistics, and reclaim free space</div>
                            </div>
                            <Button
                                title="Queue a database maintenance job"
                                variant="outline"
                                disabled={maintenanceMut.isPending}
                                onClick={runMaintenance}
                            >Run Now</Button>
                        </div>
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
