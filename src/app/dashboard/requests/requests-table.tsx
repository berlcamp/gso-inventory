"use client"

import { useMemo } from "react"
import { ClipboardList } from "lucide-react"
import { format } from "date-fns"

import { DataTable } from "@/components/tables/data-table"
import { ExportCsvButton } from "@/components/tables/export-csv-button"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  requestColumns,
  REQUEST_SOURCE_OPTIONS,
  REQUEST_STATUS_OPTIONS,
} from "./request-columns"
import type { Office, SupplyRequestRow } from "@/types/database"

export function RequestsTable({
  rows,
  offices,
}: {
  rows: SupplyRequestRow[]
  offices: Office[]
}) {
  const { can } = usePermissions()

  const officeOptions = useMemo(
    () => offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
    [offices]
  )

  // Without `request.view_all` (supply officer, department head) the rows are
  // already scoped to the profile's own office server-side, so an office filter
  // would only offer 27 other offices that all match nothing. Gating on the
  // permission rather than `offices.length` — `getOffices()` is unscoped and
  // returns every active office to any session.
  const canViewAllOffices = can("request.view_all")

  return (
    <DataTable
      columns={requestColumns}
      data={rows}
      searchableColumns={[{ id: "request_no", title: "RIS #" }]}
      filterableColumns={[
        { id: "status", title: "Status", options: REQUEST_STATUS_OPTIONS },
        ...(canViewAllOffices
          ? [{ id: "office", title: "Office", options: officeOptions }]
          : []),
        { id: "source", title: "Source", options: REQUEST_SOURCE_OPTIONS },
      ]}
      initialSorting={[{ id: "filed", desc: true }]}
      initialColumnVisibility={{ source: false }}
      pageSize={20}
      emptyState={
        <div className="flex flex-col items-center gap-2">
          <ClipboardList className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No requests found</p>
          <p className="text-xs text-muted-foreground">
            Nothing matches the current filter
          </p>
        </div>
      }
      toolbar={(table) => (
        <ExportCsvButton
          rows={table.getFilteredRowModel().rows.map((r) => r.original)}
          filename="gso-requests"
          columns={[
            { header: "RIS #", value: (r) => r.request_no },
            {
              header: "Filed",
              value: (r) => format(new Date(r.requested_at), "yyyy-MM-dd"),
            },
            { header: "Office Code", value: (r) => r.office?.code },
            { header: "Office", value: (r) => r.office?.name },
            {
              header: "Requested By",
              value: (r) => r.requester?.full_name ?? r.requester_name,
            },
            { header: "Purpose", value: (r) => r.purpose },
            { header: "Status", value: (r) => r.status },
            { header: "Source", value: (r) => r.source },
          ]}
        />
      )}
    />
  )
}
