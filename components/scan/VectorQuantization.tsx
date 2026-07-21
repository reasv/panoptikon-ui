import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/use-toast"
import { FilterContainer } from "../sidebar/base/FilterContainer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2 } from "lucide-react"
import { useSystemConfig } from "@/lib/useSystemConfig"
import { components } from "@/lib/panoptikon"
import { keepPreviousData } from "@tanstack/react-query"
import { useState } from "react"

type QuantStatus = components["schemas"]["VectorQuantStatus"]

type QuantsConfig = components["schemas"]["VectorQuantsConfig"]
type ProfileStatus = components["schemas"]["VectorQuantProfileStatus"]

// Absent [vector_quants] section means exactly this (day-1 behavior).
const builtinDefault: QuantsConfig = {
    default: "default",
    profiles: [{ name: "default", quantizer: "binary", centered: true }],
}

function effectiveQuantsConfig(config: { vector_quants?: QuantsConfig | null } | undefined): QuantsConfig {
    const section = config?.vector_quants
    if (!section) {
        return { ...builtinDefault, profiles: [...(builtinDefault.profiles || [])] }
    }
    return { default: section.default, profiles: [...(section.profiles || [])] }
}

function profileChip(profile: ProfileStatus): string {
    if (profile.state === "removing") return "Removing"
    if (profile.state === "missing") return "Reconcile needed"
    // No coverage rows is not readiness: either the DB has no embeddings
    // yet, or the rows haven't been written — search is exact either way.
    if (profile.setters.length === 0) return "No embeddings"
    if (profile.setters.every((setter) => setter.state === "ready")) return "Ready"
    const total = profile.setters.reduce((acc, setter) => acc + setter.vectors, 0)
    const done = profile.setters.reduce((acc, setter) => acc + setter.quantized, 0)
    if (profile.setters.some((setter) => setter.state === "building")) {
        const pct = total > 0 ? Math.round((100 * done) / total) : 0
        return `Building ${pct}%`
    }
    return "Pending"
}

// Anything that is still moving: drift waiting on a reconcile, a reconcile in
// flight, or a profile/setter that hasn't reached its steady state yet.
function isConverging(status: QuantStatus | undefined): boolean {
    if (!status) return false
    if (status.reconcile_needed || status.reconcile_scheduled) return true
    return status.profiles.some(
        (profile) =>
            profile.state !== "active" ||
            profile.setters.some((setter) => setter.state !== "ready"),
    )
}

function setterStateLabel(state: string): string {
    return state.charAt(0).toUpperCase() + state.slice(1)
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function VectorQuantization() {
    const [dbs, ___] = useSelectedDBs()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const { config, changeConfig } = useSystemConfig()
    const [newName, setNewName] = useState("")
    const [newCentered, setNewCentered] = useState(true)

    // The card shows progress and size on disk, so it opts into the
    // per-setter counts (full scans) the selector skips.
    const statusQuery = $api.useQuery(
        "get",
        "/api/jobs/quants",
        {
            params: {
                query: { ...dbs, counts: true }
            }
        },
        {
            placeholderData: keepPreviousData,
            // counts:true means a full scan per setter, so this doesn't get
            // the flat 2.5s of the other cards: poll fast only while
            // something is actually converging, and idle slowly otherwise.
            refetchInterval: (query) =>
                isConverging(query.state.data as QuantStatus | undefined) ? 2000 : 20000,
        },
    )
    const invalidateStatus = () => {
        queryClient.invalidateQueries({ queryKey: ["get", "/api/jobs/quants"] })
        queryClient.invalidateQueries({ queryKey: ["get", "/api/jobs/queue"] })
    }
    const reconcileMut = $api.useMutation("post", "/api/jobs/quants/reconcile", {
        onSuccess: (data) => {
            invalidateStatus()
            toast({ title: "Reconcile", description: data.detail })
        },
    })
    const rebuildMut = $api.useMutation("post", "/api/jobs/quants/rebuild", {
        onSuccess: (data) => {
            invalidateStatus()
            toast({ title: "Rebuild", description: data.detail })
        },
        onError: (error) => {
            const detail = (error as { detail?: string } | null)?.detail
            toast({
                title: "Rebuild failed",
                description: detail || "The server rejected the request",
                variant: "destructive",
            })
        },
    })

    const status = statusQuery.data
    const quants = effectiveQuantsConfig(config)
    const configured = new Set((quants.profiles || []).map((profile) => profile.name))

    const saveQuants = (next: QuantsConfig) =>
        changeConfig((currentConfig) => ({
            ...currentConfig,
            vector_quants: next,
        }))

    const addProfile = () => {
        const name = newName.trim()
        if (!name || configured.has(name)) {
            return
        }
        const profiles = [
            ...(quants.profiles || []),
            { name, quantizer: "binary", centered: newCentered },
        ]
        saveQuants({ default: quants.default ?? name, profiles })
        setNewName("")
    }
    const removeProfile = (name: string) => {
        const profiles = (quants.profiles || []).filter((profile) => profile.name !== name)
        const nextDefault =
            quants.default === name ? (profiles[0]?.name ?? null) : quants.default
        saveQuants({ default: profiles.length > 0 ? nextDefault : null, profiles })
    }
    const setDefault = (name: string) => {
        saveQuants({ ...quants, default: name })
    }

    return (
        <FilterContainer
            label="Vector Quantization"
            description="Binary quant profiles that accelerate vector search (exact rescoring keeps result quality)"
            storageKey="vectorQuantization"
        >
            {status?.reconcile_scheduled ? (
                // Every action that creates drift also enqueues the reconcile
                // that clears it, so the common case is "already handled".
                <div className="mt-4 rounded-lg border p-4 text-sm flex flex-row items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>
                        A reconcile job is queued or running — this card follows it as it
                        converges the database to the configuration.
                    </span>
                </div>
            ) : status?.reconcile_needed ? (
                <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex flex-row items-center justify-between gap-4">
                    <span>
                        Configuration and database state differ — a reconcile is needed
                        (it also runs automatically after any scan or extraction job).
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={reconcileMut.isPending}
                        onClick={() => reconcileMut.mutate({ params: { query: dbs } })}
                    >
                        Reconcile now
                    </Button>
                </div>
            ) : null}
            {(status?.profiles || []).map((profile) => (
                <div key={profile.name} className="flex flex-col items-left rounded-lg border p-4 mt-4">
                    <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                {profile.name}
                                {profile.is_default && (
                                    <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                                )}
                            </Label>
                            <div className="text-gray-400 text-sm">
                                {profile.quantizer}
                                {profile.centered ? " · centered" : ""}
                                {" · "}
                                {profileChip(profile)}
                                {profile.size_bytes > 0 && ` · ${formatBytes(profile.size_bytes)}`}
                            </div>
                        </div>
                        <div className="flex flex-row space-x-2">
                            {!profile.is_default && profile.state !== "removing" && configured.has(profile.name) && (
                                <Button variant="outline" size="sm" onClick={() => setDefault(profile.name)}>
                                    Set default
                                </Button>
                            )}
                            {configured.has(profile.name) && (
                                <Button variant="outline" size="sm" onClick={() => removeProfile(profile.name)}>
                                    Remove
                                </Button>
                            )}
                        </div>
                    </div>
                    {profile.setters.length > 0 && (
                        <div className="mt-3 space-y-2">
                            {profile.setters.map((setter) => {
                                const stale =
                                    setter.state === "ready" &&
                                    setter.n_at_artifact != null &&
                                    setter.vectors > 0 &&
                                    setter.vectors >= setter.n_at_artifact * 4
                                return (
                                    // Fixed action column so the status text ends
                                    // (and the buttons start) at the same x on
                                    // every row, whether or not the row has one.
                                    <div
                                        key={setter.setter_name}
                                        className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-3 text-sm border rounded-md px-3 py-2"
                                    >
                                        <span className="font-mono truncate" title={setter.setter_name}>
                                            {setter.setter_name}
                                        </span>
                                        <span className="text-muted-foreground text-right tabular-nums whitespace-nowrap">
                                            {setter.state === "ready"
                                                ? `Ready · ${setter.quantized.toLocaleString()} vectors`
                                                : `${setterStateLabel(setter.state)} · ${setter.quantized.toLocaleString()} / ${setter.vectors.toLocaleString()}`}
                                            {stale && (
                                                <span className="text-yellow-600 dark:text-yellow-500">
                                                    {` · artifact from ${setter.n_at_artifact!.toLocaleString()} — rebuild recommended`}
                                                </span>
                                            )}
                                        </span>
                                        <div className="flex justify-end">
                                            {setter.state === "ready" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={rebuildMut.isPending}
                                                    onClick={() =>
                                                        rebuildMut.mutate({
                                                            params: { query: dbs },
                                                            body: {
                                                                profile: profile.name,
                                                                setter_name: setter.setter_name,
                                                            },
                                                        })
                                                    }
                                                >
                                                    Rebuild
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            ))}
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <Label className="text-base">Add profile</Label>
                <div className="text-gray-400 text-sm">
                    Profiles coexist side by side and are selectable per query — compare
                    them on your own data before switching the default.
                </div>
                <div className="flex flex-row items-center space-x-2 mt-3">
                    <Input
                        type="text"
                        placeholder="Profile name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="max-w-48"
                    />
                    <div className="flex flex-row items-center space-x-2">
                        <Switch checked={newCentered} onCheckedChange={setNewCentered} />
                        <span className="text-sm">Mean-centered</span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!newName.trim() || configured.has(newName.trim())}
                        onClick={addProfile}
                    >
                        Add
                    </Button>
                </div>
            </div>
        </FilterContainer>
    )
}
