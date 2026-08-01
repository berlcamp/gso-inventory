"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { DataTableColumnHeader } from "@/components/tables/data-table-column-header"
import type { OfficeStockRow } from "@/types/database"

/** Bucket a row falls into for the "Stock level" filter. */
export type StockLevel = "out" | "low" | "ok"

export function stockLevel(row: OfficeStockRow, threshold: number): StockLevel {
  const remaining = Number(row.quantity)
  if (remaining <= 0) return "out"
  if (remaining <= threshold) return "low"
  return "ok"
}

export const STOCK_LEVEL_OPTIONS = [
  { label: "Out of stock", value: "out" },
  { label: "Low stock", value: "low" },
  { label: "In stock", value: "ok" },
]

export function getInventoryColumns(
  lowStockThreshold: number
): ColumnDef<OfficeStockRow>[] {
  return [
    {
      id: "item",
      accessorFn: (row) => row.item?.name ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Item" />
      ),
      cell: ({ row }) => (
        <p className="truncate text-sm font-medium">
          {row.original.item?.name ?? "—"}
        </p>
      ),
      meta: { cellClassName: "max-w-[280px]" },
    },
    {
      // Filtered by category id, but sorted and read as the category name.
      id: "category",
      accessorFn: (row) => row.item?.category?.id ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Category" />
      ),
      cell: ({ row }) => row.original.item?.category?.name ?? "—",
      filterFn: (row, id, value: string[]) =>
        value.includes(row.getValue(id) as string),
      sortingFn: (a, b) =>
        (a.original.item?.category?.name ?? "").localeCompare(
          b.original.item?.category?.name ?? ""
        ),
      meta: {
        headerClassName: "hidden xl:table-cell",
        cellClassName:
          "hidden max-w-[200px] truncate text-xs text-muted-foreground xl:table-cell",
      },
    },
    {
      id: "office",
      accessorFn: (row) => row.office?.id ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Office" />
      ),
      cell: ({ row }) => (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {row.original.office?.code}
        </span>
      ),
      filterFn: (row, id, value: string[]) =>
        value.includes(row.getValue(id) as string),
      sortingFn: (a, b) =>
        (a.original.office?.code ?? "").localeCompare(
          b.original.office?.code ?? ""
        ),
    },
    {
      id: "unit",
      accessorFn: (row) => row.item?.unit?.code ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Unit" />
      ),
      cell: ({ row }) => row.original.item?.unit?.code ?? "—",
      meta: {
        headerClassName: "hidden sm:table-cell",
        cellClassName: "hidden text-sm text-muted-foreground sm:table-cell",
      },
    },
    {
      id: "opening",
      accessorFn: (row) => Number(row.opening_quantity),
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Opening"
          className="justify-end"
        />
      ),
      cell: ({ row }) => Number(row.original.opening_quantity).toLocaleString(),
      meta: {
        headerClassName: "hidden text-right md:table-cell",
        cellClassName:
          "hidden text-right tabular-nums text-muted-foreground md:table-cell",
      },
    },
    {
      id: "issued",
      accessorFn: (row) => Number(row.opening_quantity) - Number(row.quantity),
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Issued"
          className="justify-end"
        />
      ),
      cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      meta: {
        headerClassName: "hidden text-right md:table-cell",
        cellClassName:
          "hidden text-right tabular-nums text-muted-foreground md:table-cell",
      },
    },
    {
      id: "remaining",
      accessorFn: (row) => Number(row.quantity),
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Remaining"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const level = stockLevel(row.original, lowStockThreshold)
        return (
          <span
            className={
              level === "out"
                ? "text-red-700"
                : level === "low"
                ? "text-amber-700"
                : "text-foreground"
            }
          >
            {Number(row.original.quantity).toLocaleString()}
          </span>
        )
      },
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right font-semibold tabular-nums",
      },
    },
    {
      // Kept hidden (see initialColumnVisibility) — it exists only to give the
      // toolbar something to filter stock level on. Hidden columns still take
      // part in filtering and faceting.
      id: "level",
      accessorFn: (row) => stockLevel(row, lowStockThreshold),
      header: () => null,
      filterFn: (row, id, value: string[]) =>
        value.includes(row.getValue(id) as string),
      enableSorting: false,
    },
  ]
}
