import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getOfficeStocks } from "@/lib/actions/inventory"
import { getCategories, getOffices } from "@/lib/actions/catalog"
import { getSystemSettings } from "@/lib/actions/settings"
import { InventoryContent } from "./inventory-content"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    office?: string
    category?: string
    search?: string
    low?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? "1") || 1

  const [stocksResult, officesResult, categoriesResult, settingsResult] = await Promise.all([
    getOfficeStocks({
      officeId: params.office,
      categoryId: params.category,
      search: params.search,
      lowOnly: params.low === "1",
      page,
      pageSize: PAGE_SIZE,
    }),
    getOffices(),
    getCategories(),
    getSystemSettings(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Remaining supply balance per office for the fiscal year"
      />

      {stocksResult.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{stocksResult.error}</AlertDescription>
        </Alert>
      )}

      <InventoryContent
        rows={stocksResult.data.rows}
        count={stocksResult.data.count}
        offices={officesResult.data}
        categories={categoriesResult.data}
        lowStockThreshold={settingsResult.data.low_stock_threshold}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
