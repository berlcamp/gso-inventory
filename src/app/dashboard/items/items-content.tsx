"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { Tags } from "lucide-react"

import { DataTable } from "@/components/tables/data-table"
import { ExportCsvButton } from "@/components/tables/export-csv-button"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { getItemColumns, ITEM_STATUS_OPTIONS } from "./item-columns"
import { AddCategoryDialog, AddUnitDialog, ItemDialog } from "./item-dialogs"
import type { Category, ItemWithRefs, Unit } from "@/types/database"

export function ItemsContent({
  rows,
  categories,
  units,
}: {
  rows: ItemWithRefs[]
  categories: Category[]
  units: Unit[]
}) {
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can("item.manage")

  const refresh = () => router.refresh()

  const columns = useMemo(
    () => getItemColumns({ canManage, categories, units, onDone: refresh }),
    // `refresh` is stable enough — router.refresh is identity-stable per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, categories, units]
  )

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.id })),
    [categories]
  )
  const unitOptions = useMemo(
    () => units.map((u) => ({ label: `${u.code} — ${u.name}`, value: u.id })),
    [units]
  )

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchableColumns={[{ id: "name", title: "item" }]}
      filterableColumns={[
        { id: "category", title: "Category", options: categoryOptions },
        { id: "unit", title: "Unit", options: unitOptions },
        { id: "status", title: "Status", options: ITEM_STATUS_OPTIONS },
      ]}
      emptyState={
        <div className="flex flex-col items-center gap-2">
          <Tags className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No items found</p>
          <p className="text-xs text-muted-foreground">
            Nothing matches the current filter
          </p>
        </div>
      }
      toolbar={(table) => (
        <>
          <ExportCsvButton
            rows={table.getFilteredRowModel().rows.map((r) => r.original)}
            filename="gso-items"
            columns={[
              { header: "Item", value: (r) => r.name },
              { header: "Description", value: (r) => r.description },
              { header: "Category", value: (r) => r.category?.name },
              { header: "Unit", value: (r) => r.unit?.code },
              { header: "Reorder At", value: (r) => Number(r.reorder_level) },
              { header: "Status", value: (r) => (r.is_active ? "Active" : "Inactive") },
            ]}
          />
          {canManage && (
            <>
              <AddCategoryDialog onDone={refresh} />
              <AddUnitDialog onDone={refresh} />
              <ItemDialog
                categories={categories}
                units={units}
                onDone={refresh}
              />
            </>
          )}
        </>
      )}
    />
  )
}
