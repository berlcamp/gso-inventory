import Link from "next/link"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus } from "lucide-react"
import { getRequests } from "@/lib/actions/requests"
import { getOffices } from "@/lib/actions/catalog"
import { RequestsTable } from "./requests-table"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    office?: string
    search?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? "1") || 1

  const [requestsResult, officesResult] = await Promise.all([
    getRequests({
      status: params.status,
      officeId: params.office,
      search: params.search,
      page,
      pageSize: PAGE_SIZE,
    }),
    getOffices(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supply Requests"
        subtitle="Requisition and issue slips filed with the General Services Office"
        actions={
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/requests/new" />}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        }
      />

      {requestsResult.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{requestsResult.error}</AlertDescription>
        </Alert>
      )}

      <RequestsTable
        rows={requestsResult.data.rows}
        count={requestsResult.data.count}
        offices={officesResult.data}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
