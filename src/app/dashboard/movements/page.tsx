import { Suspense } from "react"
import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Info } from "lucide-react"
import { getAllStockMovements } from "@/lib/actions/inventory"
import { getOffices } from "@/lib/actions/catalog"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"
import { MovementsContent } from "./movements-content"

export const dynamic = "force-dynamic"

export default async function MovementsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Ledger"
        subtitle="Every movement that changed an office balance"
      />

      <Suspense fallback={<DataTableSkeleton columns={7} filters={2} />}>
        <Results />
      </Suspense>
    </div>
  )
}

async function Results() {
  const [movementsResult, officesResult] = await Promise.all([
    getAllStockMovements(),
    getOffices(),
  ])

  if (movementsResult.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{movementsResult.error}</AlertDescription>
      </Alert>
    )
  }

  const { rows, total, limit } = movementsResult.data
  const isTruncated = total > rows.length

  return (
    <div className="space-y-4">
      {/* The ledger is the one table here that grows without bound, so it is
          loaded in a capped slice. Say so rather than quietly showing part of
          it — filters below only search what was loaded. */}
      {isTruncated && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Showing the {limit.toLocaleString()} most recent movements of{" "}
            {total.toLocaleString()}. Filters and search apply to these only —
            use Reports for a full-period export.
          </AlertDescription>
        </Alert>
      )}

      <MovementsContent rows={rows} offices={officesResult.data} />
    </div>
  )
}
