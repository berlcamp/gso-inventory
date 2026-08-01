import { Suspense } from "react"
import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getAllItems, getCategories, getUnits } from "@/lib/actions/catalog"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"
import { ItemsContent } from "./items-content"

export const dynamic = "force-dynamic"

export default async function ItemsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        subtitle="Supply catalog — categories, units, and reorder levels"
      />

      <Suspense fallback={<DataTableSkeleton columns={5} filters={3} />}>
        <Results />
      </Suspense>
    </div>
  )
}

async function Results() {
  const [itemsResult, categoriesResult, unitsResult] = await Promise.all([
    getAllItems(),
    getCategories(),
    getUnits(),
  ])

  if (itemsResult.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{itemsResult.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <ItemsContent
      rows={itemsResult.data}
      categories={categoriesResult.data}
      units={unitsResult.data}
    />
  )
}
