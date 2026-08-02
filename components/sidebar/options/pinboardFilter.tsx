import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { ComboBoxResponsive } from "../../combobox";
import { MultiBoxResponsive } from "../../multiCombobox";
import { useSelectedDBs } from "@/lib/state/database";
import { usePinboardsFilter } from "@/lib/state/searchQuery/clientHooks";
import { inPinboardsMode } from "@/lib/state/searchQuery/searchQueryKeyMaps";
import { useClientConfig } from "@/lib/useClientConfig";

const modeOptions = [
    { value: "any", label: "In any pinboard" },
    { value: "boards", label: "In selected pinboards" },
    { value: "unpinned", label: "Not pinned" },
]

export function PinboardsFilter() {
    const [dbs, ___] = useSelectedDBs()
    const clientConfig = useClientConfig()
    const pinboardsEnabled = clientConfig.data?.pinboardSearchEnabled === true
    const [pinboardsFilter, setPinboardsFilter] = usePinboardsFilter()
    // Same tuning as the grid's Library tab: the board list only moves when a
    // save/rename/delete invalidates it, so refocusing the window must not
    // refetch it, and the sidebar's own remounts are served from cache.
    const { data } = $api.useQuery(
        "get",
        "/api/pinboards",
        { params: { query: { ...dbs } } },
        {
            enabled: pinboardsEnabled,
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
        }
    )
    // Gated on the same capability as the grid's Library tab: both belong to
    // the pinboard search domain, and the gate is deliberately shared so a
    // server without it exposes no pinboard-search surface at all.
    if (!pinboardsEnabled) {
        // `queryFromState` is capability-blind by design (it must stay pure for
        // SSR parity), so a `pb.filter=true` left in the URL keeps narrowing
        // results even here. Returning null would make that narrowing invisible
        // and unfixable, so keep just enough card to switch it back off.
        if (!pinboardsFilter.filter) {
            return null
        }
        return (
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Pinboards
                        </Label>
                        <div className="text-gray-400">
                            A pinboard filter is active but pinboard search is unavailable on this server.
                        </div>
                    </div>
                    <Switch checked={pinboardsFilter.filter} onCheckedChange={(value) => setPinboardsFilter({
                        filter: value
                    })} />
                </div>
            </div>
        )
    }
    const boards = data?.pinboards || []
    const knownIds = new Set(boards.map((board) => board.id))
    // Ids can outlive their board (deleted elsewhere, or restored from a stale
    // URL/history entry). Without an option they show up as bare numbers in the
    // button label and have no row to uncheck, so synthesize one — but only
    // while the id is actually selected, so the list stays clean otherwise.
    // Skipped until the list has actually arrived, so a pending (or failed)
    // fetch doesn't label every selected board as deleted.
    const orphanIds = data
        ? Array.from(
            new Set(pinboardsFilter.pinboard_ids.filter((id) => !knownIds.has(id)))
        )
        : []
    const boardOptions = [
        ...boards.map((board) => ({
            value: String(board.id),
            label: board.name || `Untitled #${board.id}`,
        })),
        ...orphanIds.map((id) => ({
            value: String(id),
            label: `Deleted board #${id}`,
        })),
    ]
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Pinboards
                    </Label>
                    <div className="text-gray-400">
                        Filter items by pinboard membership
                    </div>
                </div>
                <Switch checked={pinboardsFilter.filter} onCheckedChange={(value) => setPinboardsFilter({
                    filter: value
                })} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={modeOptions}
                    currentValue={pinboardsFilter.mode}
                    onChangeValue={(value) => value && setPinboardsFilter({
                        mode: value as inPinboardsMode
                    })}
                    placeholder="Select mode"
                />
            </div>
            {pinboardsFilter.mode === "boards" && (
                <>
                    <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                        <MultiBoxResponsive
                            options={boardOptions}
                            currentValues={pinboardsFilter.pinboard_ids.map(String)}
                            onSelectionChange={(values) => setPinboardsFilter({
                                pinboard_ids: values.map(Number)
                            })}
                            placeholder="Select pinboards"
                            maxDisplayed={3}
                            buttonClassName="max-w-[310px] sm:max-w-[505px] md:max-w-[620px] lg:max-w-[350px] xl:max-w-[270px] 3xl:max-w-[300px] 4xl:max-w-[292px] 5xl:max-w-[370px]"
                        />
                    </div>
                    {/* With no boards picked the filter composes to nothing
                        (see `queryFromState`), so say so rather than leave the
                        ON switch implying an active filter. */}
                    {pinboardsFilter.pinboard_ids.length === 0 && (
                        <div className="text-gray-400 mt-2">
                            Select pinboards to activate this filter.
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
