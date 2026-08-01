"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { Boxes } from "lucide-react"

import { DataTable } from "@/components/tables/data-table"
import { ExportCsvButton } from "@/components/tables/export-csv-button"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  getInventoryColumns,
  STOCK_LEVEL_OPTIONS,
} from "./inventory-columns"
import { AdjustStockDialog } from "./adjust-stock-dialog"
import type { Category, Office, OfficeStockRow } from "@/types/database"

export function InventoryTable({
  rows,
  offices,
  categories,
  lowStockThreshold,
}: {
  rows: OfficeStockRow[]
  offices: Office[]
  categories: Category[]
  lowStockThreshold: number
}) {
  const router = useRouter()
  const { can } = usePermissions()

  const columns = useMemo(
    () => getInventoryColumns(lowStockThreshold),
    [lowStockThreshold]
  )

  // Filters list every office and category, not just the ones present in the
  // rows, so an empty result still shows why.
  const officeOptions = useMemo(
    () =>
      offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
    [offices]
  )
  const categoryOptions = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.id })),
    [categories]
  )

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchableColumns={[{ id: "item", title: "item" }]}
      filterableColumns={[
        { id: "office", title: "Office", options: officeOptions },
        { id: "category", title: "Category", options: categoryOptions },
        { id: "level", title: "Stock level", options: STOCK_LEVEL_OPTIONS },
      ]}
      initialColumnVisibility={{ level: false }}
      emptyState={
        <div className="flex flex-col items-center gap-2">
          <Boxes className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No stock records found</p>
          <p className="text-xs text-muted-foreground">
            Nothing matches the current filter
          </p>
        </div>
      }
      toolbar={(table) => (
        <>
          <ExportCsvButton
            rows={table.getFilteredRowModel().rows.map((r) => r.original)}
            filename="gso-stock-balances"
            columns={[
              { header: "Office Code", value: (r) => r.office?.code },
              { header: "Office", value: (r) => r.office?.name },
              { header: "Category", value: (r) => r.item?.category?.name },
              { header: "Item", value: (r) => r.item?.name },
              { header: "Unit", value: (r) => r.item?.unit?.code },
              { header: "Opening", value: (r) => Number(r.opening_quantity) },
              {
                header: "Issued",
                value: (r) => Number(r.opening_quantity) - Number(r.quantity),
              },
              { header: "Remaining", value: (r) => Number(r.quantity) },
            ]}
          />
          {can("inventory.adjust") && (
            <AdjustStockDialog
              offices={offices}
              onDone={() => router.refresh()}
            />
          )}
        </>
      )}
    />
  )
}
