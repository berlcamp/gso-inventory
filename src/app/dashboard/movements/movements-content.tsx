"use client"

import { useMemo } from "react"
import { ArrowLeftRight } from "lucide-react"
import { format } from "date-fns"

import { DataTable } from "@/components/tables/data-table"
import { ExportCsvButton } from "@/components/tables/export-csv-button"
import { movementColumns, MOVEMENT_TYPE_OPTIONS } from "./movement-columns"
import type { Office, StockMovementRow } from "@/types/database"

export function MovementsContent({
  rows,
  offices,
}: {
  rows: StockMovementRow[]
  offices: Office[]
}) {
  const officeOptions = useMemo(
    () => offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
    [offices]
  )

  return (
    <DataTable
      columns={movementColumns}
      data={rows}
      searchableColumns={[{ id: "item", title: "item" }]}
      filterableColumns={[
        { id: "office", title: "Office", options: officeOptions },
        { id: "movement_type", title: "Type", options: MOVEMENT_TYPE_OPTIONS },
      ]}
      initialSorting={[{ id: "date", desc: true }]}
      emptyState={
        <div className="flex flex-col items-center gap-2">
          <ArrowLeftRight className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No movements found</p>
          <p className="text-xs text-muted-foreground">
            Nothing matches the current filter
          </p>
        </div>
      }
      toolbar={(table) => (
        <ExportCsvButton
          rows={table.getFilteredRowModel().rows.map((r) => r.original)}
          filename="gso-stock-ledger"
          columns={[
            {
              header: "Date",
              value: (r) => format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
            },
            { header: "RIS #", value: (r) => r.request?.request_no },
            { header: "Office Code", value: (r) => r.office?.code },
            { header: "Office", value: (r) => r.office?.name },
            { header: "Category", value: (r) => r.item?.category?.name },
            { header: "Item", value: (r) => r.item?.name },
            { header: "Unit", value: (r) => r.item?.unit?.code },
            { header: "Type", value: (r) => r.movement_type },
            { header: "Quantity", value: (r) => Number(r.quantity) },
            { header: "Balance After", value: (r) => Number(r.balance_after) },
            { header: "Performed By", value: (r) => r.performer?.full_name },
            { header: "Remarks", value: (r) => r.remarks },
          ]}
        />
      )}
    />
  )
}
