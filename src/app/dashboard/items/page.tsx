import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getCategories, getItems, getUnits } from "@/lib/actions/catalog"
import { ItemsContent } from "./items-content"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? "1") || 1

  const [itemsResult, categoriesResult, unitsResult] = await Promise.all([
    getItems({
      search: params.search,
      categoryId: params.category,
      activeOnly: false,
      page,
      pageSize: PAGE_SIZE,
    }),
    getCategories(),
    getUnits(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        subtitle="Supply catalog — categories, units, and reorder levels"
      />

      {itemsResult.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{itemsResult.error}</AlertDescription>
        </Alert>
      )}

      <ItemsContent
        rows={itemsResult.data.rows}
        count={itemsResult.data.count}
        categories={categoriesResult.data}
        units={unitsResult.data}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
