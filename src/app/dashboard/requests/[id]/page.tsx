import { notFound } from "next/navigation"
import { PageHeader } from "@/components/layout/page-header"
import {
  getRequest,
  getRequestLogs,
  getRequestAvailability,
} from "@/lib/actions/requests"
import { RequestDetail } from "./request-detail"

export const dynamic = "force-dynamic"

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const requestResult = await getRequest(id)

  if (!requestResult.data) {
    if (requestResult.error === "Request not found.") notFound()
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">
          {requestResult.error ?? "Could not load this request."}
        </p>
      </div>
    )
  }

  const request = requestResult.data
  const [logsResult, availabilityResult] = await Promise.all([
    getRequestLogs(id),
    getRequestAvailability(id),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.request_no}
        subtitle={`${request.office?.code ?? ""} — ${request.office?.name ?? ""}`}
      />
      <RequestDetail
        request={request}
        logs={logsResult.data}
        availability={availabilityResult.data}
      />
    </div>
  )
}
