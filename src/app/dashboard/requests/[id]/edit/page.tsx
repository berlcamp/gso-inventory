import { notFound } from "next/navigation"
import { PageHeader } from "@/components/layout/page-header"
import { getRequest, getRequestAvailability } from "@/lib/actions/requests"
import { EditRequestForm } from "./edit-request-form"

export const dynamic = "force-dynamic"

/**
 * Editing a slip that has not been endorsed yet — its own route rather than a
 * dialog on the detail page, because the item picker is the same two-column
 * editor the new-request form uses and does not fit in a modal.
 *
 * `getRequestAvailability` excludes this request from `committed`, which is
 * exactly what an edit needs: a slip must not be told it is competing with the
 * quantities it already asked for.
 */
export default async function EditRequestPage({
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
  const availabilityResult = await getRequestAvailability(id)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${request.request_no}`}
        subtitle={`${request.office?.code ?? ""} — ${request.office?.name ?? ""}`}
      />
      <EditRequestForm
        request={request}
        availability={availabilityResult.data}
      />
    </div>
  )
}
