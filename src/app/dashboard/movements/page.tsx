import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getStockMovements } from "@/lib/actions/inventory"
import { getOffices } from "@/lib/actions/catalog"
import { MovementsContent } from "./movements-content"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    office?: string
    type?: string
    from?: string
    to?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? "1") || 1

  const [movementsResult, officesResult] = await Promise.all([
    getStockMovements({
      officeId: params.office,
      movementType: params.type,
      from: params.from,
      to: params.to,
      page,
      pageSize: PAGE_SIZE,
    }),
    getOffices(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Ledger"
        subtitle="Every movement that changed an office balance"
      />

      {movementsResult.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{movementsResult.error}</AlertDescription>
        </Alert>
      )}

      <MovementsContent
        rows={movementsResult.data.rows}
        count={movementsResult.data.count}
        offices={officesResult.data}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
