"use client"

import { type Table } from "@tanstack/react-table"
import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import type {
  DataTableFilterableColumn,
  DataTableSearchableColumn,
} from "./data-table"

export function DataTableToolbar<TData>({
  table,
  filterableColumns = [],
  searchableColumns = [],
  children,
}: {
  table: Table<TData>
  filterableColumns?: DataTableFilterableColumn[]
  searchableColumns?: DataTableSearchableColumn[]
  children?: React.ReactNode
}) {
  const isFiltered = table.getState().columnFilters.length > 0

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {searchableColumns.map((column) =>
          table.getColumn(column.id) ? (
            <div key={column.id} className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={`Search ${column.title}…`}
                value={
                  (table.getColumn(column.id)?.getFilterValue() as string) ?? ""
                }
                onChange={(event) =>
                  table.getColumn(column.id)?.setFilterValue(event.target.value)
                }
                className="h-8 w-[180px] pl-8 lg:w-[250px]"
              />
            </div>
          ) : null
        )}

        {filterableColumns.map((column) =>
          table.getColumn(column.id) ? (
            <DataTableFacetedFilter
              key={column.id}
              column={table.getColumn(column.id)}
              title={column.title}
              options={column.options}
            />
          ) : null
        )}

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
