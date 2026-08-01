import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import {
  getIssuanceByOffice,
  getIssuanceByCategory,
  getMonthlyTrends,
  getRequestStatusCounts,
} from "@/lib/actions/reports"
import { getOffices } from "@/lib/actions/catalog"
import { ReportsContent, type ReportFilterValues } from "./reports-content"

export const dynamic = "force-dynamic"

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; office?: string }>
}) {
  const params = await searchParams
  const fiscalYear = new Date().getFullYear()
  const filters: ReportFilterValues = {
    office: params.office ?? "",
    from: params.from ?? "",
    to: params.to ?? "",
  }
  const query = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    officeId: filters.office || undefined,
  }

  const [byOffice, byCategory, trends, statusCounts, offices] = await Promise.all([
    getIssuanceByOffice(query),
    getIssuanceByCategory(query),
    getMonthlyTrends(fiscalYear),
    getRequestStatusCounts(query),
    getOffices(),
  ])

  const error =
    byOffice.error || byCategory.error || trends.error || statusCounts.error

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Issuance and balance reporting across every office"
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ReportsContent
        byOffice={byOffice.data}
        byCategory={byCategory.data}
        trends={trends.data}
        statusCounts={statusCounts.data}
        offices={offices.data}
        filters={filters}
        fiscalYear={fiscalYear}
      />
    </div>
  )
}
