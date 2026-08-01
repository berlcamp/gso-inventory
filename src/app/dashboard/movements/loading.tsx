import { PageHeader } from "@/components/layout/page-header"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Ledger"
        subtitle="Every movement that changed an office balance"
      />
      <DataTableSkeleton columns={7} filters={2} />
    </div>
  )
}
