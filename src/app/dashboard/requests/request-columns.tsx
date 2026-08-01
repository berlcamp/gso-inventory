"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { formatDistanceToNow } from "date-fns"

import { DataTableColumnHeader } from "@/components/tables/data-table-column-header"
import { StatusBadge } from "@/components/shared/status-badge"
import type { SupplyRequestRow } from "@/types/database"

export const REQUEST_STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Partially Released", value: "partially_released" },
  { label: "Released", value: "released" },
  { label: "Rejected", value: "rejected" },
  { label: "Cancelled", value: "cancelled" },
]

export const REQUEST_SOURCE_OPTIONS = [
  { label: "Filed online", value: "online" },
  { label: "Walk-in", value: "walk_in" },
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
    // Hidden; drives the "Source" filter only.
    id: "source",
    accessorKey: "source",
    header: () => null,
    filterFn: includesValue,
    enableSorting: false,
  },
]
