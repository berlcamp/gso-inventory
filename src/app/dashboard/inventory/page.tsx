import { Suspense } from "react"
import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getAllOfficeStocks } from "@/lib/actions/inventory"
import { getCategories, getOffices } from "@/lib/actions/catalog"
import { getSystemSettings } from "@/lib/actions/settings"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"
import { InventoryTable } from "./inventory-table"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Remaining supply balance per office for the fiscal year"
      />

      {/* Nothing is awaited above the boundary, so the header paints straight
          away while the rows load. Filtering happens in the browser from here. */}
      <Suspense fallback={<DataTableSkeleton columns={7} filters={3} />}>
        <Results />
      </Suspense>
    </div>
  )
}

async function Results() {
  const [stocksResult, officesResult, categoriesResult, settingsResult] =
    await Promise.all([
      getAllOfficeStocks(),
      getOffices(),
      getCategories(),
      getSystemSettings(),
    ])

  if (stocksResult.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{stocksResult.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <InventoryTable
      rows={stocksResult.data}
      offices={officesResult.data}
      categories={categoriesResult.data}
      lowStockThreshold={settingsResult.data.low_stock_threshold}
    />
  )
}
