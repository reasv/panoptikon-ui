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
    index,
    variant,
    setValue,
}: {
    model: string
    index: components["schemas"]["IndexMode"]
    variant: string | null
    setValue: (value: { index: vectorIndexMode; variant: string }) => void
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/jobs/quants", {
        params: {
            query: dbs
        }
    })
    const profiles = data?.profiles || []
    const profileLabel = (profile: components["schemas"]["VectorQuantProfileStatus"]) => {
        const coverage = profile.setters.find((setter) => setter.setter_name === model)
        const ready = profile.state === "active" && coverage?.state === "ready"
        if (ready) {
            return profile.name
        }
        const state = coverage ? coverage.state : profile.state
        return `${profile.name} (${state})`
    }
    const options = [
        { value: "auto", label: "Auto" },
        { value: "exact", label: "Exact" },
        ...profiles.map((profile) => ({
            value: `profile:${profile.name}`,
            label: profileLabel(profile),
        })),
    ]
    const currentValue =
        index === "quant" && variant ? `profile:${variant}` : index
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
