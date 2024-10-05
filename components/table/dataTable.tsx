"use client"

import * as React from "react"
import {
    ColumnDef,
    ColumnFiltersState,
    OnChangeFn,
    RowSelectionState,
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
import { useColumnVisibility, useTableStore } from "@/lib/state/columnShow"

export function DataTable<TData, TValue>(
    {
        data,
        columns,
        filterColumn,
        filterPlaceholder,
        storageKey,
        defaultPageSize = 10,
        rowSelection,
        setRowSelection,
        header,
    }: {
        data: TData[],
        columns: ColumnDef<TData, TValue>[],
        storageKey: string,
        filterColumn?: string,
        filterPlaceholder?: string,
        defaultPageSize?: number,
        rowSelection?: RowSelectionState,
        setRowSelection?: OnChangeFn<RowSelectionState>,
        header?: React.ReactNode,
    }) {
    "use no memo"
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [pagination, setPagination] = React.useState({
        pageIndex: 0,
        pageSize: defaultPageSize,
    })
    // Get the current column visibility using the zustand selector
    const columnVisibility = useColumnVisibility(storageKey);

    // Access the zustand action to set the column visibility
    const setTableVisibility = useTableStore((state) => state.setTableVisibility);

    // Function to handle visibility changes
    const handleVisibilityChange = (updaterOrValue: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
        if (typeof updaterOrValue === "function") {
            // Apply the updater function to the current visibility state
            const newState = updaterOrValue(columnVisibility);
            setTableVisibility(storageKey, newState);
        } else {
            // Set the new visibility state directly
            setTableVisibility(storageKey, updaterOrValue);
        }
    };

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnFilters,
            pagination,
            columnVisibility,
            rowSelection,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: handleVisibilityChange,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onRowSelectionChange: setRowSelection,
    })
    const [open, setOpen] = React.useState(false)
    return (
        <div className="w-full">
            <div className="flex items-center py-4">
                {filterColumn && <Input
                    placeholder={filterPlaceholder ?? "Filter..."}
                    value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
                    onChange={(event) =>
                        table.getColumn(filterColumn)?.setFilterValue(event.target.value)
                    }
                    className="max-w-sm"
                />}
                {header}
                <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="ml-auto">
                            Columns <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                        {table
                            .getAllColumns()
                            .filter((column) => column.getCanHide())
                            .map((column) => {
                                return (
                                    <DropdownMenuCheckboxItem
                                        key={column.id}
                                        className="capitalize"
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) => {
                                            column.toggleVisibility(!!value)
                                        }}
                                        onSelect={(event) => {
                                            event.preventDefault()
                                        }}
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
                                    data-state={(rowSelection !== undefined ? row.getIsSelected() : null) && "selected"}
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
