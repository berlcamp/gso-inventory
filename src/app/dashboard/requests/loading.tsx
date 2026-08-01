import { PageHeader } from "@/components/layout/page-header"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Supply Requests"
        subtitle="Requisition and issue slips filed with the General Services Office"
      />
      <DataTableSkeleton columns={6} filters={3} />
    </div>
  )
}
