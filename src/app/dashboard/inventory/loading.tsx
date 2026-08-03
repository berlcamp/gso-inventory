import { PageHeader } from "@/components/layout/page-header"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Remaining supply balance per office for the fiscal year"
      />
      <DataTableSkeleton columns={6} filters={3} />
    </div>
  )
}
