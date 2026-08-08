'use client'

import { useEffect, useState } from "react"
import { Database, TriangleAlert } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { $api } from "@/lib/api"
import { PinboardDatabaseRow, useIndexDatabaseNames } from "@/lib/pinboardLinks"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

/** What the editor needs off a board summary — list rows and matches alike. */
export interface AssociationEditorBoard {
    id: number
    name?: string | null
    associated: boolean
    databases: PinboardDatabaseRow[]
}

// One checklist row. `local` rows address a database that exists here. The
// others are stamps whose database is gone (renamed, retired, or another
// instance's) — the server cannot mint those again, so unchecking one is the
// only edit available, and once saved it cannot be added back.
interface DatabaseRow {
    name: string
    local: boolean
}

const foldedHas = (names: readonly string[], name: string) =>
    names.some((other) => other.toLowerCase() === name.toLowerCase())

/**
 * Builds the checklist: every local index database, then every stamped name
 * that no longer resolves to one. Local databases come first and keep the
 * server's own order, so the list doesn't reshuffle as stamps change.
 *
 * The leftovers are deduped by EXACT name because a board can carry several
 * stamps under ONE name — a database rebuilt from its TOML mints a fresh UUID
 * and stamps a second row beside the old one, byte-identical db_name — and
 * once that folder is gone, both rows land here. They are one checklist entry
 * (the request is by name, and a listed name carries every stamp stored under
 * it), and rendering them twice would also duplicate the React key. Exact,
 * not case-folded: the server carries stamps by exact string, so collapsing
 * case-variant leftovers into one row would make saving that row silently
 * drop the other spelling's stamps — unresolvable stamps can't be re-minted.
 */
function buildRows(
    localNames: string[],
    databases: PinboardDatabaseRow[]
): DatabaseRow[] {
    const leftovers: string[] = []
    for (const { name } of databases) {
        if (foldedHas(localNames, name)) continue
        if (leftovers.includes(name)) continue
        leftovers.push(name)
    }
    return [
        ...localNames.map((name) => ({ name, local: true })),
        ...leftovers.map((name) => ({ name, local: false })),
    ]
}

/**
 * The manual association editor: which index databases a board belongs to.
 *
 * Non-optional counterpart to the automatic rule — an automatic-only list can
 * only ever grow, and renames, accidental stamps and instance-identity resets
 * all need somewhere to go. A `null` board means closed.
 *
 * The endpoint replaces the whole list, so this always sends every checked
 * name. Saving an unchanged list is meaningful rather than a no-op: a name
 * whose database was rebuilt gets re-pointed at the new one, which is the
 * only way to repair a stale stamp.
 */
export function PinboardDatabasesDialog({
    board,
    dbs,
    onClose,
    onSaved,
}: {
    board: AssociationEditorBoard | null
    dbs: { index_db: string | null; user_data_db: string | null }
    onClose: () => void
    /** Called after a successful save so the host can refresh its listing. */
    onSaved: () => void
}) {
    const { toast } = useToast()
    const { localNames, currentName, ready } = useIndexDatabaseNames(
        board != null
    )
    // The authoritative post-save state, once there is one: the response is
    // the full verdict, so the dialog stops guessing the moment it arrives.
    const [saved, setSaved] = useState<{
        associated: boolean
        databases: PinboardDatabaseRow[]
    } | null>(null)
    // Ticks the user actually made. Null means "nothing touched yet", and the
    // stamped set below stands in — derived at render rather than seeded by an
    // effect, because the local database list arrives with its own query and
    // an effect that ran before it landed would check nothing.
    const [checked, setChecked] = useState<string[] | null>(null)
    useEffect(() => {
        setSaved(null)
        setChecked(null)
    }, [board?.id])

    const current = saved ?? board
    const databases = current?.databases ?? []
    const stampedNames = databases.map((database) => database.name)
    const rows = buildRows(localNames, databases)
    // Row order, not stamp order: the request order then never depends on
    // when a stamp happened to be written.
    const stamped = rows
        .filter((row) => foldedHas(stampedNames, row.name))
        .map((row) => row.name)
    const selected = checked ?? stamped

    const mutation = $api.useMutation(
        "put",
        "/api/pinboards/{pinboard_id}/databases",
        {
            onSuccess: (data) => {
                setSaved(data)
                // Back to "nothing touched", so the ticks re-derive from the
                // response through the same case-folded row matching the rest
                // of this dialog uses. Seeding them from the raw stamp names
                // would leave a carried row whose stamp spelling differs in
                // case from its folder's unticked — and the next save would
                // then send the stamp spelling instead of the folder's.
                setChecked(null)
                onSaved()
                toast({ title: "Saved database associations", duration: 2000 })
            },
            onError: (error) => {
                // 400 names the offending databases in `detail`, and nothing
                // was written — so the ticks stay exactly as the user left
                // them and the same Save can be retried after a fix.
                //
                // Cast through `unknown` because the OpenAPI document declares
                // no body for the 400 (the utoipa response has a description
                // and no `body =`), which generates the error type as
                // `undefined` — while the gateway does send `{detail}`, as
                // every other error path in this app does.
                const detail = (error as unknown as { detail?: string } | null)
                    ?.detail
                toast({
                    title: "Couldn't save associations",
                    description: detail || "The server rejected the request",
                    variant: "destructive",
                })
            },
        }
    )

    const toggle = (name: string, next: boolean) =>
        setChecked((prev) => {
            const list = prev ?? stamped
            if (next) return list.includes(name) ? list : [...list, name]
            return list.filter((other) => other !== name)
        })

    const submit = () => {
        if (!board) return
        mutation.mutate({
            params: { path: { pinboard_id: board.id }, query: { ...dbs } },
            body: { databases: selected },
        })
    }

    // Three distinct states, and the third is worth spelling out: a board can
    // belong to the selected database purely because every one of its items is
    // present there, with no stamp behind it at all.
    const selectedLabel = currentName ? `“${currentName}”` : "the selected database"
    const status = !(current?.associated ?? false)
        ? `Not associated with ${selectedLabel}`
        : databases.some((database) => database.associated)
            ? `Associated with ${selectedLabel}`
            : `Associated with ${selectedLabel} by content — every item on this`
                + " board is already there"

    return (
        <Dialog
            open={board != null}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="pr-8 truncate">
                        Databases — {board?.name || (
                            <span className="italic text-muted-foreground">Untitled</span>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        Which index databases this board belongs to. Board lists
                        can hide boards belonging to another database, and such a
                        board&apos;s link opens it in the database it belongs to.
                    </DialogDescription>
                </DialogHeader>
                {/* A plain scroller rather than the Radix ScrollArea: this list
                    is a handful of rows and has no fixed height to give one. */}
                <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-0.5">
                    {/* Nothing is rendered before the local list lands: with
                        it absent every stamp classifies as unavailable, which
                        would flash the retired-database styling across rows
                        that are perfectly fine. */}
                    {!ready || rows.length === 0 ? (
                        <p className="py-2 text-sm text-muted-foreground">
                            {ready ? "No index databases found" : "Loading…"}
                        </p>
                    ) : rows.map((row, index) => (
                        <div key={row.name} className="flex items-center gap-2">
                            <Checkbox
                                id={`pinboard-db-${index}`}
                                checked={selected.includes(row.name)}
                                onCheckedChange={(next) =>
                                    toggle(row.name, next === true)
                                }
                            />
                            <label
                                htmlFor={`pinboard-db-${index}`}
                                title={row.local
                                    ? undefined
                                    : "This database doesn't exist here any more."
                                        + " The stamp is kept as a label — unchecking"
                                        + " it is the only change possible, and saving"
                                        + " that is final."}
                                className={cn(
                                    "flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-sm",
                                    !row.local && "text-muted-foreground"
                                )}
                            >
                                {row.local ? (
                                    <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="truncate">{row.name}</span>
                                {!row.local && (
                                    <span className="shrink-0 text-xs italic">
                                        unavailable
                                    </span>
                                )}
                                {row.local && row.name === currentName && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        (viewing)
                                    </span>
                                )}
                            </label>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">{status}</p>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    {/* Not before the local list lands either: the request is
                        built from the rows, and rows built without it would
                        send stamp spellings for databases that do resolve. */}
                    <Button
                        onClick={submit}
                        disabled={!ready || mutation.isPending}
                    >
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
