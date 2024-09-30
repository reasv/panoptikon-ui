"use client"

import * as React from "react"
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData } from "@tanstack/react-query"

type FileScanRecord = components["schemas"]["FileScanRecord"]

function prettyPrintDate(isoDateString: string): string {
    const date = new Date(isoDateString);
    if (isNaN(date.getTime())) {
        return "Invalid date";
    }
    const options: Intl.DateTimeFormatOptions = {
        year: '2-digit',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    };
    return new Intl.DateTimeFormat('en-GB', options).format(date);
}

function prettyPrintDurationBetweenDates(isoDateStart: string, isoDateEnd: string): string {
    const startDate = new Date(isoDateStart);
    const endDate = new Date(isoDateEnd);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return "Invalid date(s)";
    }
    const diffInSeconds = Math.abs((endDate.getTime() - startDate.getTime()) / 1000);
    return prettyPrintDuration(diffInSeconds);
}

function prettyPrintDuration(seconds: number): string {
    if (seconds < 0) return "Invalid duration";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let result = "";
    if (hours > 0) {
        result += `${hours}h`;
        if (minutes > 0) {
            result += ` ${minutes}m`;
        }
    } else {
        if (minutes > 0) {
            result += `${minutes}m`;
        }
        if (minutes === 0 && secs > 0) {
            result += `${secs.toFixed(1)}s`;
        }
    }
    return result.trim();
}

export function ScanPage() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/folders/history",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )

    const columns = React.useMemo<ColumnDef<FileScanRecord>[]>(() => [
        {
            accessorKey: "id",
            header: "ID",
        },
        {
            accessorKey: "start_time",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Start Time
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => prettyPrintDate(row.getValue("start_time")),
        },
        {
            accessorKey: "end_time",
            header: "End Time",
            cell: ({ row }) => prettyPrintDate(row.getValue("end_time")),
        },
        {
            accessorKey: "duration",
            header: "Duration",
            cell: ({ row }) => prettyPrintDurationBetweenDates(row.getValue("start_time"), row.getValue("end_time")),
        },
        {
            accessorKey: "path",
            header: "Path",
        },
        {
            accessorKey: "total_available",
            header: "Total Available",
        },
        {
            accessorKey: "marked_unavailable",
            header: "Marked Unavailable",
        },
        {
            accessorKey: "errors",
            header: "Errors",
        },
        {
            accessorKey: "new_items",
            header: "New Items",
        },
        {
            accessorKey: "new_files",
            header: "New Files",
        },
        {
            accessorKey: "unchanged_files",
            header: "Unchanged Files",
        },
        {
            accessorKey: "modified_files",
            header: "Modified Files",
        },
        {
            accessorKey: "false_changes",
            header: "Wrongly Detected Changes",
        },
        {
            accessorKey: "metadata_time",
            header: "Metadata Scan Time",
            cell: ({ row }) => prettyPrintDuration(row.getValue("metadata_time")),
        },
        {
            accessorKey: "hashing_time",
            header: "File Hashing Time",
            cell: ({ row }) => prettyPrintDuration(row.getValue("hashing_time")),
        },
        {
            accessorKey: "thumbgen_time",
            header: "Thumb Gen Time",
            cell: ({ row }) => prettyPrintDuration(row.getValue("thumbgen_time")),
        },
    ], [])

    const memoizedData = React.useMemo<FileScanRecord[]>(() => data || [], [data])


    return (
        <div className="flex w-full h-screen">
            <div className={'p-4 mx-auto w-full'}>
                {isFetching ? (
                    <div>Loading...</div>
                ) : isError ? (
                    <div>Error: {(error as any).message}</div>
                ) : (
                    <DataTable data={memoizedData} columns={columns} />
                )}
            </div>
        </div>
    )
}

export function DataTable({ data, columns }: { data: FileScanRecord[], columns: ColumnDef<FileScanRecord>[] }) {
    // State management for sorting, filtering, pagination, and column visibility
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [pagination, setPagination] = React.useState({
        pageIndex: 0,
        pageSize: 10,
    })
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnFilters,
            pagination,
            columnVisibility,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: setColumnVisibility,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        debugTable: false, // Set to true for debugging
    })

    // Optional: Log table state for debugging
    React.useEffect(() => {
        console.log("Table State:", table.getState())
    }, [table.getState()])

    return (
        <div className="w-full">
            <div className="flex items-center py-4">
                <Input
                    placeholder="Filter paths..."
                    value={(table.getColumn("path")?.getFilterValue() as string) ?? ""}
                    onChange={(event) =>
                        table.getColumn("path")?.setFilterValue(event.target.value)
                    }
                    className="max-w-sm"
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="ml-auto">
                            Columns <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {table
                            .getAllColumns()
                            .filter((column) => column.getCanHide())
                            .map((column) => {
                                return (
                                    <DropdownMenuCheckboxItem
                                        key={column.id}
                                        className="capitalize"
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) =>
                                            column.toggleVisibility(!!value)
                                        }
                                    >
                                        {column.id}
                                    </DropdownMenuCheckboxItem>
                                )
                            })}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id}>
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-between space-x-2 py-4">
                <div className="flex-1 text-sm text-muted-foreground">
                    {table.getFilteredRowModel().rows.length > 0 ? (
                        <>
                            Showing {(table.getState().pagination.pageIndex * table.getState().pagination.pageSize) + 1} to{" "}
                            {Math.min(
                                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                                table.getFilteredRowModel().rows.length
                            )}{" "}
                            of {table.getFilteredRowModel().rows.length} results
                        </>
                    ) : (
                        "No results."
                    )}
                </div>
                <div className="space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    )
}
