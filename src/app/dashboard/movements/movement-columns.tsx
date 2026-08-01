"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"

import { DataTableColumnHeader } from "@/components/tables/data-table-column-header"
import { MovementBadge } from "@/components/shared/status-badge"
import type { StockMovementRow } from "@/types/database"

export const MOVEMENT_TYPE_OPTIONS = [
  { label: "Release", value: "release" },
  { label: "Replenishment", value: "replenishment" },
  { label: "Return", value: "return" },
  { label: "Adjustment", value: "adjustment" },
  { label: "Opening", value: "opening" },
]

const includesValue = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => value.includes(row.getValue(id) as string)

export const movementColumns: ColumnDef<StockMovementRow>[] = [
  {
    id: "date",
    accessorFn: (row) => new Date(row.created_at).getTime(),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    cell: ({ row }) => (
      <>
        {format(new Date(row.original.created_at), "dd MMM yyyy")}
        <span className="block text-[11px] text-muted-foreground">
          {format(new Date(row.original.created_at), "h:mm a")}
        </span>
      </>
    ),
    meta: { cellClassName: "whitespace-nowrap text-xs text-muted-foreground" },
  },
  {
    id: "item",
    accessorFn: (row) => row.item?.name ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Item" />
    ),
    cell: ({ row }) => (
      <>
        <p className="truncate text-sm font-medium">
          {row.original.item?.name ?? "—"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.original.item?.unit?.code ?? ""}
        </p>
      </>
    ),
    meta: { cellClassName: "max-w-[260px]" },
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
    filterFn: includesValue,
    sortingFn: (a, b) =>
      (a.original.office?.code ?? "").localeCompare(
        b.original.office?.code ?? ""
      ),
  },
  {
    id: "movement_type",
    accessorKey: "movement_type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => <MovementBadge type={row.original.movement_type} />,
    filterFn: includesValue,
  },
  {
    id: "quantity",
    accessorFn: (row) => Number(row.quantity),
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Qty"
        className="justify-end"
      />
    ),
    cell: ({ getValue }) => {
      const qty = getValue() as number
      return (
        <span className={qty < 0 ? "text-red-700" : "text-green-700"}>
          {qty > 0 ? "+" : ""}
          {qty.toLocaleString()}
        </span>
      )
    },
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right font-semibold tabular-nums",
    },
  },
  {
    id: "balance_after",
    accessorFn: (row) => Number(row.balance_after),
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Balance"
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
    id: "reference",
    accessorFn: (row) => row.request?.request_no ?? row.remarks ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reference" />
    ),
    cell: ({ row }) => (
      <>
        {row.original.request ? (
          <Link
            href={`/dashboard/requests/${row.original.request.id}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            {row.original.request.request_no}
          </Link>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {row.original.remarks ?? "—"}
          </span>
        )}
        {row.original.performer && (
          <span className="block text-[11px] text-muted-foreground">
            {row.original.performer.full_name}
          </span>
        )}
      </>
    ),
    enableSorting: false,
    meta: {
      headerClassName: "hidden lg:table-cell",
      cellClassName: "hidden max-w-[220px] lg:table-cell",
    },
  },
]
