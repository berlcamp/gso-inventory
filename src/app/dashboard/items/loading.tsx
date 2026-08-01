import { PageHeader } from "@/components/layout/page-header"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        subtitle="Supply catalog — categories, units, and reorder levels"
      />
      <DataTableSkeleton columns={5} filters={3} />
    </div>
  )
}
