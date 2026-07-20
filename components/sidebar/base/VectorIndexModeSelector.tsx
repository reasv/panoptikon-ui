import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { ComboBoxResponsive } from "@/components/combobox"
import { components } from "@/lib/panoptikon"
import { vectorIndexMode } from "@/lib/state/searchQuery/searchQueryKeyMaps"

/**
 * Index mode selector for vector search surfaces: Auto (default), Exact,
 * then each quant profile by name. Profiles that exist but aren't ready for
 * the relevant model are labeled with their state — invisible-when-building
 * would read as a bug in the minutes after an upgrade.
 */
export function VectorIndexModeSelector({
    model,
    clipXmodal,
    index,
    variant,
    setValue,
}: {
    model: string
    /** Cross-modal searches also read the 't'-prefixed sibling setter, and
     * the backend requires BOTH to be ready under one shared artifact — so
     * readiness must be reported over the whole space, not just the model. */
    clipXmodal?: boolean
    index: components["schemas"]["IndexMode"]
    variant: string | null
    setValue: (value: { index: vectorIndexMode; variant: string }) => void
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data, isError } = $api.useQuery("get", "/api/jobs/quants", {
        params: {
            // counts=false skips the per-setter full index scans: this
            // selector only needs profile names and states, and it renders
            // on the search page where those scans would compete with the
            // search the user is waiting on.
            query: { ...dbs, counts: false }
        }
    }, {
        // Up to three search surfaces share this key; don't re-run it on
        // every window refocus.
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    })
    const requiredSetters = clipXmodal && model ? [model, `t${model}`] : [model]
    const profiles = data?.profiles || []
    const profileState = (profile: components["schemas"]["VectorQuantProfileStatus"]) => {
        if (profile.state !== "active") {
            return profile.state
        }
        // Setters with no coverage row yet are not ready (search falls back
        // to exact for them), and a sibling that isn't ready blocks the
        // whole space.
        const coverages = requiredSetters.map((setter) =>
            profile.setters.find((entry) => entry.setter_name === setter)
        )
        const present = coverages.filter((coverage) => coverage !== undefined)
        if (present.length === 0) {
            return "pending"
        }
        const blocked = present.find((coverage) => coverage!.state !== "ready")
        return blocked ? blocked!.state : "ready"
    }
    const options = [
        { value: "auto", label: "Auto" },
        { value: "exact", label: "Exact" },
        ...profiles.map((profile) => {
            const state = profileState(profile)
            return {
                value: `profile:${profile.name}`,
                label: state === "ready" ? profile.name : `${profile.name} (${state})`,
            }
        }),
    ]
    // A variant is a strict selection server-side regardless of index mode,
    // so it must be shown as selected even when the URL says "auto" — and a
    // profile that no longer exists (or a failed status query) still needs a
    // visible selection to explain the resulting error.
    if (variant && !profiles.some((profile) => profile.name === variant)) {
        options.push({
            value: `profile:${variant}`,
            label: `${variant} (${isError ? "unavailable" : "not found"})`,
        })
    }
    const currentValue = variant ? `profile:${variant}` : index
    const onChangeValue = (value: string | null) => {
        if (!value) {
            return
        }
        if (value.startsWith("profile:")) {
            setValue({ index: "quant", variant: value.slice("profile:".length) })
        } else if (value === "auto" || value === "exact") {
            setValue({ index: value, variant: "" })
        }
    }
    return (
        <ComboBoxResponsive
            options={options}
            currentValue={currentValue}
            onChangeValue={onChangeValue}
            placeholder="Index..."
        />
    )
}
