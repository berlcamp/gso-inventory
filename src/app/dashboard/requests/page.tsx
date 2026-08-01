import { Suspense } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus } from "lucide-react"
import { getAllRequests } from "@/lib/actions/requests"
import { getOffices } from "@/lib/actions/catalog"
import { DataTableSkeleton } from "@/components/tables/data-table-skeleton"
import { RequestsTable } from "./requests-table"

export const dynamic = "force-dynamic"

export default async function RequestsPage() {
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

      <Suspense fallback={<DataTableSkeleton columns={6} filters={3} />}>
        <Results />
      </Suspense>
    </div>
  )
}

async function Results() {
  const [requestsResult, officesResult] = await Promise.all([
    getAllRequests(),
    getOffices(),
  ])

  if (requestsResult.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{requestsResult.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <RequestsTable rows={requestsResult.data} offices={officesResult.data} />
  )
}
