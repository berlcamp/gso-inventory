"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { formatDistanceToNow } from "date-fns"

import { DataTableColumnHeader } from "@/components/tables/data-table-column-header"
import { ReceiptBadge, StatusBadge } from "@/components/shared/status-badge"
import { rollUpReceipt } from "@/lib/requests/receipt"
import type { SupplyRequestRow } from "@/types/database"

export { RECEIPT_FILTER_OPTIONS } from "@/lib/requests/receipt"

export const REQUEST_STATUS_OPTIONS = [
  { label: "For Endorsement", value: "awaiting_endorsement" },
  { label: "For GSO Review", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Partially Released", value: "partially_released" },
  { label: "Released", value: "released" },
  { label: "Rejected", value: "rejected" },
  { label: "Cancelled", value: "cancelled" },
]

const includesValue = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => value.includes(row.getValue(id) as string)

export const requestColumns: ColumnDef<SupplyRequestRow>[] = [
  {
    id: "request_no",
    accessorKey: "request_no",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="RIS #" />
    ),
    cell: ({ row }) => (
      <>
        <Link
          href={`/dashboard/requests/${row.original.id}`}
          className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          {row.original.request_no}
        </Link>
        {/* Walk-in issuance was retired in migration 12 — only rows filed
            before that can still carry the tag, and they still need labelling
            for anyone reading back through the year. */}
        {row.original.source === "walk_in" && (
          <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
            WALK-IN
          </span>
        )}
      </>
    ),
  },
  {
    id: "office",
    accessorFn: (row) => row.office?.id ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Office" />
    ),
    cell: ({ row }) => (
      <>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {row.original.office?.code}
        </span>
        <span className="ml-2 hidden max-w-[200px] truncate align-middle text-sm xl:inline-block">
          {row.original.office?.name}
        </span>
      </>
    ),
    filterFn: includesValue,
    sortingFn: (a, b) =>
      (a.original.office?.code ?? "").localeCompare(
        b.original.office?.code ?? ""
      ),
    meta: { cellClassName: "font-medium text-foreground" },
  },
  {
    id: "purpose",
    accessorFn: (row) => row.purpose ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Purpose" />
    ),
    cell: ({ row }) => row.original.purpose || "—",
    meta: {
      headerClassName: "hidden lg:table-cell",
      cellClassName:
        "hidden max-w-[240px] truncate text-sm text-muted-foreground lg:table-cell",
    },
  },
  {
    id: "requester",
    accessorFn: (row) =>
      row.requester?.full_name ?? row.requester_name ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Requested by" />
    ),
    cell: ({ getValue }) => (getValue() as string) || "—",
    meta: {
      headerClassName: "hidden md:table-cell",
      cellClassName: "hidden text-sm text-muted-foreground md:table-cell",
    },
  },
  {
    id: "status",
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    filterFn: includesValue,
  },
  {
    id: "filed",
    accessorFn: (row) => new Date(row.requested_at).getTime(),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Filed" />
    ),
    cell: ({ row }) =>
      formatDistanceToNow(new Date(row.original.requested_at), {
        addSuffix: true,
      }),
    meta: {
      headerClassName: "hidden sm:table-cell",
      cellClassName: "hidden text-xs text-muted-foreground sm:table-cell",
    },
  },
  {
    // Where the slip stands with the office that received the goods. Rolled up
    // from its releases, because acknowledgement is per handover and a request
    // can have several — see `rollUpReceipt` for the precedence.
    id: "receipt",
    accessorFn: (row) => rollUpReceipt(row.request_releases),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Receipt" />
    ),
    cell: ({ getValue }) => {
      const state = getValue() as ReturnType<typeof rollUpReceipt>
      if (state === "none") {
        return <span className="text-xs text-muted-foreground">—</span>
      }
      return <ReceiptBadge state={state} />
    },
    filterFn: includesValue,
    meta: {
      headerClassName: "hidden lg:table-cell",
      cellClassName: "hidden lg:table-cell",
    },
  },
]
