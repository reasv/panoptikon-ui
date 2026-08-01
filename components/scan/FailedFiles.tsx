import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"
import { components } from "@/lib/panoptikon"
import { FilterContainer } from "../sidebar/base/FilterContainer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { prettyPrintDate } from "@/components/table/utils"
import { useFailedFilesTab } from "@/lib/state/ScanTabs"
import { ReactNode, useEffect, useState } from "react"

type ExtractionFailure = components["schemas"]["ExtractionFailure"]
type ScanFailure = components["schemas"]["ScanFailure"]

// One server page. The API clamps at 1000; this is the window the card asks
// for and also the step the Previous/Next buttons move by.
const PAGE_SIZE = 50

// "All" is not a value the API accepts (an unknown error_class is a 400, so a
// typo can never read as "no failures"), so the absent filter needs its own
// sentinel: Radix Select rejects an empty-string item value.
const ANY_CLASS = "any"

// The source of truth for this vocabulary is the Rust constant
// `db::ledger::ERROR_CLASSES` (panoptikon/src/db/ledger.rs), which is also
// what the API validates the `error_class` filter against — anything not in
// that list is a 400, not an empty page. The labels are ours; the values are
// not, so a new class ships there first.
const ERROR_CLASSES = [
    { value: "input", label: "Input — the media itself was rejected" },
    { value: "blocked", label: "Blocked — a dependency is missing" },
    { value: "resource", label: "Resource — the entry blew a limit" },
]

// How often the header count polls. Deliberately slower than the tables':
// this one runs even while the card is collapsed, so it is the only query the
// page pays for in the common case.
const COUNT_POLL_MS = 10000

// The ledger is read-only from here by design: a row is cleared when the
// file's content changes, when a missing dependency appears, or by a shipped
// retry directive — never by a button.
export function FailedFiles() {
    const [failedFilesTab, setFailedFilesTab] = useFailedFilesTab()
    const total = useFailureTotal()
    return (
        <FilterContainer
            label={
                <div className="flex items-center gap-2">
                    <span>Failed Files</span>
                    {total > 0 && (
                        <Badge
                            variant="secondary"
                            title="Recorded scan and extraction failures across both ledgers"
                        >
                            {total}
                        </Badge>
                    )}
                </div>
            }
            description="Files the scan or a model could not process. These are skipped on later runs, so they are the reason for work that never completes."
            storageKey="failedFiles"
            // The card is collapsed by default and its two tables poll every
            // 2.5s; without this they keep polling behind a closed card on
            // every page that mounts it. The header count below is what still
            // has to run, and it does so at a tenth of the rate.
            unMountOnCollapse
        >
            <Tabs
                defaultValue="extraction"
                value={failedFilesTab}
                onValueChange={(value) => setFailedFilesTab(value as any)}
                className="mt-4"
            >
                <TabsList>
                    <TabsTrigger value="extraction">Extraction Failures</TabsTrigger>
                    <TabsTrigger value="scan">File Scan Failures</TabsTrigger>
                </TabsList>
                <TabsContent value="extraction">
                    <ExtractionFailures />
                </TabsContent>
                <TabsContent value="scan">
                    <ScanFailures />
                </TabsContent>
            </Tabs>
        </FilterContainer>
    )
}

// The collapsed card is otherwise indistinguishable from one with nothing in
// it, and "nothing is wrong" is the one thing this surface must not imply by
// omission. Both ledgers are asked for a single row because only `total`
// matters, and neither read is gated on the card being open — that is the
// whole point of the count.
function useFailureTotal() {
    const [dbs] = useSelectedDBs()
    const countParams = { params: { query: { ...dbs, limit: 1 } } }
    const countOptions = { refetchInterval: COUNT_POLL_MS }
    const { data: extraction } = $api.useQuery(
        "get",
        "/api/jobs/data/failures",
        countParams,
        countOptions,
    )
    const { data: scan } = $api.useQuery(
        "get",
        "/api/jobs/scan/failures",
        countParams,
        countOptions,
    )
    return (extraction?.total || 0) + (scan?.total || 0)
}

export function ExtractionFailures() {
    const [dbs] = useSelectedDBs()
    const [errorClass, setErrorClass] = useState(ANY_CLASS)
    const [offset, setOffset] = useState(0)
    useResetOffsetOnDbChange(setOffset)
    const { data } = $api.useQuery(
        "get",
        "/api/jobs/data/failures",
        {
            params: {
                query: {
                    ...dbs,
                    error_class: errorClass === ANY_CLASS ? undefined : errorClass,
                    limit: PAGE_SIZE,
                    offset,
                },
            },
        },
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    const failures: ExtractionFailure[] = data?.failures || []
    return (
        <FailureTable
            errorClass={errorClass}
            setErrorClass={setErrorClass}
            offset={offset}
            setOffset={setOffset}
            total={data?.total || 0}
            rows={failures.length}
            headers={["Path", "Model", "Stage", "Class", "Error", "Attempts", "Last Seen"]}
        >
            {failures.map((failure) => (
                <TableRow key={failure.id}>
                    <PathCell path={failure.path} fallback={failure.sha256} />
                    <TableCell className="font-mono">{failure.setter_name}</TableCell>
                    <TableCell>{failure.stage}</TableCell>
                    <ClassCell errorClass={failure.error_class} blocker={failure.blocker} />
                    <ErrorCell error={failure.error} />
                    <AttemptsCell
                        attempts={failure.attempts}
                        skipAfter={failure.skip_after}
                        active={failure.active}
                        ledger="extraction"
                    />
                    <TableCell>{prettyPrintDate(failure.last_seen)}</TableCell>
                </TableRow>
            ))}
        </FailureTable>
    )
}

// Switching databases replaces the whole result set, exactly like changing
// the class filter does — an offset kept across the switch lands the user on a
// blank page of a ledger they have not seen the first page of.
function useResetOffsetOnDbChange(setOffset: (value: number) => void) {
    const [dbs] = useSelectedDBs()
    useEffect(() => {
        setOffset(0)
        // `setOffset` is a useState setter and stable; the DB pair is the
        // actual trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbs.index_db, dbs.user_data_db])
}

export function ScanFailures() {
    const [dbs] = useSelectedDBs()
    const [errorClass, setErrorClass] = useState(ANY_CLASS)
    const [offset, setOffset] = useState(0)
    useResetOffsetOnDbChange(setOffset)
    const { data } = $api.useQuery(
        "get",
        "/api/jobs/scan/failures",
        {
            params: {
                query: {
                    ...dbs,
                    error_class: errorClass === ANY_CLASS ? undefined : errorClass,
                    limit: PAGE_SIZE,
                    offset,
                },
            },
        },
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    const failures: ScanFailure[] = data?.failures || []
    return (
        <FailureTable
            errorClass={errorClass}
            setErrorClass={setErrorClass}
            offset={offset}
            setOffset={setOffset}
            total={data?.total || 0}
            rows={failures.length}
            headers={["Path", "Type", "Stage", "Class", "Error", "Attempts", "Last Seen"]}
        >
            {failures.map((failure) => (
                <TableRow key={failure.id}>
                    <PathCell path={failure.path} fallback="" />
                    <TableCell className="font-mono">{failure.mime_type || "unknown"}</TableCell>
                    <TableCell>{failure.stage}</TableCell>
                    <ClassCell errorClass={failure.error_class} blocker={failure.blocker} />
                    <ErrorCell error={failure.error} />
                    <AttemptsCell
                        attempts={failure.attempts}
                        skipAfter={failure.skip_after}
                        active={failure.active}
                        ledger="scan"
                        stage={failure.stage}
                    />
                    <TableCell>{prettyPrintDate(failure.last_seen)}</TableCell>
                </TableRow>
            ))}
        </FailureTable>
    )
}

// The two ledgers differ only in their middle columns, so the filter bar, the
// frame and the paging controls are shared: a user reading one tab must not
// have to relearn the other.
function FailureTable({
    errorClass,
    setErrorClass,
    offset,
    setOffset,
    total,
    rows,
    headers,
    children,
}: {
    errorClass: string
    setErrorClass: (value: string) => void
    offset: number
    setOffset: (value: number) => void
    total: number
    rows: number
    headers: string[]
    children: ReactNode
}) {
    return (
        <div className="w-full">
            <div className="flex items-center py-4">
                <Select
                    value={errorClass}
                    onValueChange={(value) => {
                        // A narrower filter has fewer pages, so an offset kept
                        // from the old set would land the user on a blank one.
                        setOffset(0)
                        setErrorClass(value)
                    }}
                >
                    <SelectTrigger className="max-w-sm mr-4">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY_CLASS}>All failure classes</SelectItem>
                        {ERROR_CLASSES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <ScrollArea className="max-w-[97vw] whitespace-nowrap">
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {headers.map((header) => (
                                    <TableHead key={header}>{header}</TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows > 0 ? (
                                children
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={headers.length}
                                        className="h-24 text-center"
                                    >
                                        No recorded failures.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
            <div className="flex items-center justify-between space-x-2 py-4">
                <div className="space-x-2 mr-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                        disabled={offset === 0}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOffset(offset + PAGE_SIZE)}
                        disabled={offset + rows >= total}
                    >
                        Next
                    </Button>
                </div>
                <div className="flex-1 text-sm text-muted-foreground">
                    {rows > 0 ? (
                        <>
                            Showing {offset + 1} to {offset + rows} of {total} failures
                        </>
                    ) : (
                        "No recorded failures."
                    )}
                </div>
            </div>
        </div>
    )
}

// Paths are long and the interesting end is the right one, but truncating
// there would hide the filename; the full path is on the title either way.
function PathCell({ path, fallback }: { path?: string | null; fallback: string }) {
    return (
        <TableCell className="max-w-96">
            <div className="truncate font-mono" title={path || fallback}>
                {path || fallback || "(file no longer indexed)"}
            </div>
        </TableCell>
    )
}

// A blocked row always names its dependency, and that name is the actionable
// part ("install ffmpeg"), so it rides in the same cell as the class.
function ClassCell({ errorClass, blocker }: { errorClass: string; blocker?: string | null }) {
    return (
        <TableCell>
            {errorClass}
            {blocker && <span className="text-muted-foreground">{` · ${blocker}`}</span>}
        </TableCell>
    )
}

function ErrorCell({ error }: { error: string }) {
    return (
        <TableCell className="max-w-96">
            <div className="truncate" title={error}>
                {error}
            </div>
        </TableCell>
    )
}

// `active` is the whole point of the ledger: an inactive row was recorded but
// not confirmed, and the file will be tried again on the next run.
//
// What an *active* row means differs between the two ledgers, so the wording
// does too. An active extraction row is genuinely skipped — the work query
// anti-joins it and nothing else is consulted. An active scan row is only
// *confirmed*: the walker additionally requires the file to still have the
// mtime and size the failure was recorded against, so a repaired or otherwise
// modified file is re-attempted on the next scan regardless.
const ACTIVE_LABEL = {
    extraction: { text: "skipped", title: "Confirmed; the work query skips this item." },
    scan: {
        text: "confirmed",
        title:
            "Failures confirmed; a changed file is still retried on the next scan/job. " +
            "A decode row never suppresses anything at any count: the file is indexed and " +
            "only its visuals failed.",
    },
} as const

// A `decode` row belongs to a file that *is* indexed — only its thumbnail or
// blurhash could not be produced — so neither "skipped" nor "will retry" is
// true of it: the scan ledger schedules nothing for it either way. Saying so
// beats showing a countdown to a threshold that does nothing.
const AUDIT_ONLY_STAGE = "decode"
const AUDIT_ONLY_LABEL = {
    text: "audit only",
    title: "Recorded for audit; retry scheduling is handled by the visuals cache.",
} as const

function AttemptsCell({
    attempts,
    skipAfter,
    active,
    ledger,
    stage,
}: {
    attempts: number
    skipAfter: number
    active: boolean
    ledger: keyof typeof ACTIVE_LABEL
    stage?: string
}) {
    const auditOnly = ledger === "scan" && stage === AUDIT_ONLY_STAGE
    const activeLabel = ACTIVE_LABEL[ledger]
    const state = auditOnly
        ? AUDIT_ONLY_LABEL
        : active
          ? activeLabel
          : {
                text: "will retry",
                title: "Recorded but not yet confirmed; this will be tried again.",
            }
    return (
        <TableCell className="tabular-nums">
            {attempts}/{skipAfter}
            <span className="text-muted-foreground" title={state.title}>
                {` · ${state.text}`}
            </span>
        </TableCell>
    )
}
