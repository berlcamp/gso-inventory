"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type Table as ReactTableInstance,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableToolbar } from "./data-table-toolbar"
import type { FacetedFilterOption } from "./data-table-faceted-filter"

export interface DataTableFilterableColumn {
  id: string
  title: string
  options: FacetedFilterOption[]
}

export interface DataTableSearchableColumn {
  id: string
  /** Completes "Search …" in the placeholder. */
  title: string
}

/**
 * Client-side table: every row is held in memory, so filtering, sorting, and
 * paging happen without a server round trip. Suits the fixed-size catalogues
 * (offices × items for a fiscal year); a table that grows without bound should
 * cap what it loads and say so.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  filterableColumns = [],
  searchableColumns = [],
  toolbar,
  emptyState,
  initialSorting = [],
  initialColumnVisibility,
  initialColumnFilters,
  pageSize = 25,
  fixedLayout = false,
}: {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  filterableColumns?: DataTableFilterableColumn[]
  searchableColumns?: DataTableSearchableColumn[]
  toolbar?:
    | React.ReactNode
    | ((table: ReactTableInstance<TData>) => React.ReactNode)
  emptyState?: React.ReactNode
  initialSorting?: SortingState
  initialColumnVisibility?: VisibilityState
  /**
   * Filters the table opens with — for deep links like the dashboard's stat
   * tiles. Read once on mount, then owned by the toolbar, so clearing a chip
   * works normally instead of snapping back to the URL.
   */
  initialColumnFilters?: ColumnFiltersState
  pageSize?: number
  /**
   * Lay the table out on fixed column widths instead of sizing to content.
   * `Table` renders inside `overflow-x-auto`, so under the default auto layout
   * one long cell widens the whole table and hands the page a horizontal
   * scrollbar. With this on, every column except the flexible one needs a width
   * in its `meta.headerClassName`, and the flexible column's cell needs
   * `truncate` — it now has a definite width to truncate against.
   *
   * Off by default: a table whose columns are all short reads better sized to
   * its content.
   */
  fixedLayout?: boolean
}) {
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility ?? {})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialColumnFilters ?? []
  )
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)

  // The table instance hands back functions the React Compiler can't safely
  // memoize. That's inherent to TanStack Table, not something to fix here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnFilters },
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: true,
  })

  const rows = table.getRowModel().rows

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        filterableColumns={filterableColumns}
        searchableColumns={searchableColumns}
      >
        {typeof toolbar === "function" ? toolbar(table) : toolbar}
      </DataTableToolbar>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table className={fixedLayout ? "table-fixed" : undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-b border-border/60 bg-muted/40 hover:bg-muted/40"
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={header.column.columnDef.meta?.headerClassName}
                  >
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
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  // Visible, not all — a hidden filter-only column has no
                  // <th>, so counting it over-spans the empty-state row.
                  colSpan={table.getVisibleLeafColumns().length}
                  className="py-16 text-center text-muted-foreground"
                >
                  {emptyState ?? (
                    <p className="text-sm font-medium">No results found</p>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-border/40 hover:bg-muted/30"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.columnDef.meta?.cellClassName}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />
    </div>
  )
}
