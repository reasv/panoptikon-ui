import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import React, { useEffect } from "react"
import { FilterContainer } from "../sidebar/base/FilterContainer"
import { SwitchFilter } from "../sidebar/base/SwitchFilter"
import { Label } from "../ui/label"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { Save } from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select"
import { useToast } from "../ui/use-toast"
import { useSystemConfig } from "@/lib/useSystemConfig"

const DEFAULT_POLL_INTERVAL_SECS = 60

// Client-side mirror of the gateway's watch-root subset rule, for feedback
// before saving. The gateway remains authoritative — it additionally drops
// folders that don't exist on disk — and the status endpoint reports the
// effective outcome after saving.
function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

function isUnder(child: string, parent: string): boolean {
    const c = normalizePath(child)
    const p = normalizePath(parent)
    return c === p || c.startsWith(p + "/")
}

function findInvalidWatchedFolders(
    watched: string[],
    included: string[],
    excluded: string[],
): string[] {
    return watched.filter(
        (folder) =>
            !included.some((root) => isUnder(folder, root)) ||
            excluded.some((root) => isUnder(folder, root)),
    )
}

function StatusLine({
    enabled,
    status,
}: {
    enabled: boolean
    status?: {
        active: boolean
        paused_for_job: boolean
        roots_valid: boolean
        mode: "watcher" | "poller"
        poll_interval_secs?: number | null
        watch_roots: string[]
    }
}) {
    let color = "bg-gray-400"
    let text = "Disabled"
    if (enabled && status) {
        if (status.paused_for_job) {
            color = "bg-yellow-500"
            text = "Paused while a job is running — resumes automatically"
        } else if (!status.roots_valid) {
            color = "bg-red-500"
            text = "Inactive — none of the watched folders are valid"
        } else if (status.active) {
            color = "bg-green-500"
            const roots = `${status.watch_roots.length} folder root${status.watch_roots.length === 1 ? "" : "s"}`
            text =
                status.mode === "poller"
                    ? `Watching ${roots}, polling every ${status.poll_interval_secs}s`
                    : `Watching ${roots} for file events`
        } else {
            color = "bg-yellow-500"
            text = "Enabled but not active yet"
        }
    } else if (enabled) {
        text = "Enabled"
    }
    return (
        <div className="flex flex-row items-center text-sm mt-2" title={status?.watch_roots.join("\n")}>
            <span className={`inline-block h-2 w-2 rounded-full mr-2 ${color}`} />
            {text}
        </div>
    )
}

export function ContinuousScan() {
    const [dbs] = useSelectedDBs()
    const { config, changeConfig } = useSystemConfig()
    const { toast } = useToast()
    const { data: status } = $api.useQuery(
        "get",
        "/api/jobs/continuous/status",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
            // The scanner pauses/resumes on its own around jobs.
            refetchInterval: 2500,
        },
    )
    const continuous = config?.continuous_filescan
    const [watchedFolders, setWatchedFolders] = React.useState("")
    const [pollIntervalInput, setPollIntervalInput] = React.useState(
        String(DEFAULT_POLL_INTERVAL_SECS),
    )
    useEffect(() => {
        if (continuous) {
            setWatchedFolders((continuous.included_folders || []).join("\n"))
            if (continuous.poll_interval_secs) {
                setPollIntervalInput(String(continuous.poll_interval_secs))
            }
        }
    }, [continuous])

    const changeContinuous = (
        patch: Partial<NonNullable<typeof continuous>>,
    ) =>
        changeConfig((currentConfig) => ({
            ...currentConfig,
            continuous_filescan: {
                ...currentConfig.continuous_filescan,
                ...patch,
            },
        }))

    // poll_interval_secs doubles as the mode: null/0 means native watcher.
    const mode: "watcher" | "poller" = continuous?.poll_interval_secs
        ? "poller"
        : "watcher"
    const parsePollInterval = () => {
        const secs = parseInt(pollIntervalInput, 10)
        if (isNaN(secs) || secs < 1) {
            toast({
                title: "Invalid poll interval",
                description: "Enter a whole number of seconds, at least 1",
                variant: "destructive",
            })
            return null
        }
        return secs
    }
    const onModeChange = (value: string) => {
        if (value === "watcher") {
            changeContinuous({ poll_interval_secs: null })
        } else {
            const secs = parsePollInterval() ?? DEFAULT_POLL_INTERVAL_SECS
            setPollIntervalInput(String(secs))
            changeContinuous({ poll_interval_secs: secs })
        }
    }
    const savePollInterval = () => {
        const secs = parsePollInterval()
        if (secs !== null) {
            changeContinuous({ poll_interval_secs: secs })
        }
    }
    const saveWatchedFolders = () => {
        changeContinuous({
            included_folders: watchedFolders
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== ""),
        })
    }

    const unsavedInvalid = config
        ? findInvalidWatchedFolders(
            watchedFolders
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== ""),
            config.included_folders,
            config.excluded_folders,
        )
        : []

    return (
        <FilterContainer
            label="Continuous Scanning"
            description="Watch for file changes and index them as they happen"
            storageKey="continuousScan"
        >
            {config && continuous ? (
                <>
                    <StatusLine enabled={!!continuous.enabled} status={status} />
                    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                        <SwitchFilter
                            label="Enable Continuous Scanning"
                            description="Watch the included directories and index new, changed and deleted files immediately"
                            value={!!continuous.enabled}
                            onChange={(value) => changeContinuous({ enabled: value })}
                        />
                        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                            <div className="space-y-0.5">
                                <Label className="text-base">Change Detection</Label>
                                <div className="text-gray-400">
                                    The OS file watcher is only reliable on local folders.
                                    Network mounts (NFS/SMB) don&apos;t deliver file events —
                                    use periodic polling for those.
                                </div>
                            </div>
                            <Select value={mode} onValueChange={onModeChange}>
                                <SelectTrigger className="mt-4">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="watcher">
                                        OS File Watcher (local folders)
                                    </SelectItem>
                                    <SelectItem value="poller">
                                        Periodic Polling (network mounts)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            {mode === "poller" && (
                                <div className="flex flex-row items-center space-x-2 mt-4">
                                    <Input
                                        type="number"
                                        min={1}
                                        value={pollIntervalInput}
                                        onChange={(e) => setPollIntervalInput(e.target.value)}
                                        placeholder="Poll interval in seconds"
                                    />
                                    <Button
                                        title="Save Poll Interval"
                                        onClick={savePollInterval}
                                        variant="ghost"
                                        size="icon"
                                    >
                                        <Save className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                        <div className="space-y-0.5">
                            <Label className="text-base">Watched Folders</Label>
                            <div className="text-gray-400">
                                Restrict continuous scanning to a subset of the included
                                directories. Each path must be inside an included directory
                                and not inside an excluded one.
                            </div>
                        </div>
                        <Textarea
                            className="min-h-24 mt-4"
                            placeholder="One path per line. Leave empty to watch all included directories."
                            value={watchedFolders}
                            onChange={(e) => setWatchedFolders(e.target.value)}
                        />
                        {unsavedInvalid.length > 0 && (
                            <div className="text-sm mt-2 text-yellow-600 dark:text-yellow-500">
                                Not inside an included directory (or inside an excluded one):{" "}
                                {unsavedInvalid.join(", ")}
                            </div>
                        )}
                        {status && status.invalid_includes.length > 0 && (
                            <div className="text-sm mt-2 text-destructive">
                                Ignored by the scanner: {status.invalid_includes.join(", ")}
                            </div>
                        )}
                        {status && continuous.enabled && !status.roots_valid && (
                            <div className="text-sm mt-2 text-destructive font-medium">
                                No valid watched folders remain, so continuous scanning is
                                inactive. Fix or clear the list to resume.
                            </div>
                        )}
                        <Button
                            className="mt-4 self-start"
                            variant="outline"
                            onClick={saveWatchedFolders}
                        >
                            Save Watched Folders
                        </Button>
                    </div>
                </>
            ) : null}
        </FilterContainer>
    )
}
