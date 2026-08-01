"use client"

import type { ColumnDef } from "@tanstack/react-table"

import { DataTableColumnHeader } from "@/components/tables/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { ItemDialog } from "./item-dialogs"
import type { Category, ItemWithRefs, Unit } from "@/types/database"

export const ITEM_STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
]

const includesValue = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => value.includes(row.getValue(id) as string)

export function getItemColumns({
  canManage,
  categories,
  units,
  onDone,
}: {
  canManage: boolean
  categories: Category[]
  units: Unit[]
  onDone: () => void
}): ColumnDef<ItemWithRefs>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Item" />
      ),
      cell: ({ row }) => (
        <>
          <p className="truncate text-sm font-medium">{row.original.name}</p>
          {row.original.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {row.original.description}
            </p>
          )}
        </>
      ),
      meta: { cellClassName: "max-w-[320px]" },
    },
    {
      id: "category",
      accessorFn: (row) => row.category?.id ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Category" />
      ),
      cell: ({ row }) => row.original.category?.name ?? "—",
      filterFn: includesValue,
      sortingFn: (a, b) =>
        (a.original.category?.name ?? "").localeCompare(
          b.original.category?.name ?? ""
        ),
      meta: {
        headerClassName: "hidden lg:table-cell",
        cellClassName:
          "hidden max-w-[240px] truncate text-xs text-muted-foreground lg:table-cell",
      },
    },
    {
      id: "unit",
      accessorFn: (row) => row.unit?.id ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Unit" />
      ),
      cell: ({ row }) => row.original.unit?.code ?? "—",
      filterFn: includesValue,
      sortingFn: (a, b) =>
        (a.original.unit?.code ?? "").localeCompare(b.original.unit?.code ?? ""),
      meta: { cellClassName: "text-sm text-muted-foreground" },
    },
    {
      id: "reorder_level",
      accessorFn: (row) => Number(row.reorder_level),
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Reorder at"
          className="justify-end"
        />
      ),
      cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      meta: {
        headerClassName: "hidden text-right sm:table-cell",
        cellClassName:
          "hidden text-right tabular-nums text-muted-foreground sm:table-cell",
      },
    },
    {
      id: "status",
      accessorFn: (row) => (row.is_active ? "active" : "inactive"),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge variant="outline" className="border-green-200 text-green-700">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        ),
      filterFn: includesValue,
    },
    ...(canManage
      ? ([
          {
            id: "actions",
            header: () => null,
            cell: ({ row }) => (
              <ItemDialog
                item={row.original}
                categories={categories}
                units={units}
                onDone={onDone}
              />
            ),
            enableSorting: false,
            enableHiding: false,
            meta: { headerClassName: "w-[60px]" },
          },
        ] satisfies ColumnDef<ItemWithRefs>[])
      : []),
  ]
}
