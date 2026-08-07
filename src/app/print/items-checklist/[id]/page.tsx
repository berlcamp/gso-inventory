/**
 * The printable items checklist for one request.
 *
 * Outside `/dashboard` for the same reason the delivery receipt is: that layout
 * wraps every page in the sidebar and topbar, and hiding app chrome with print
 * rules still leaves a form sitting inside the app *on screen* — which is what
 * someone looks at before hitting print. A separate route gets a clean sheet in
 * both media for free, and it opens in its own tab so printing never takes the
 * custodian off the request they were working.
 *
 * `src/proxy.ts` already guards the whole `/print` prefix, and `getRequest`
 * re-runs `canViewRequest` — the request id in the URL grants nothing on its
 * own, exactly as on the receipt route.
 */

import { notFound } from "next/navigation"
import { getRequest } from "@/lib/actions/requests"
import { ItemsChecklist } from "./items-checklist"

export const dynamic = "force-dynamic"

/**
 * Endorsed and onward. Before that the slip is the department's own internal
 * draft — GSO cannot see it, so there is nothing for them to go and check.
 * Terminal statuses are excluded because a checklist for a slip that was
 * rejected or withdrawn would send someone to the shelves for nothing.
 */
const CHECKLIST_STATUSES = [
  "pending",
  "recommended",
  "approved",
  "partially_released",
  "released",
]

export default async function ItemsChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { data, error } = await getRequest(id)

  if (!data) {
    if (error === "Request not found.") notFound()
    return <Problem message={error ?? "Could not load this checklist."} />
  }

  // The button is already gated on this, but the URL is not the button.
  if (!CHECKLIST_STATUSES.includes(data.status)) {
    return (
      <Problem message="This request has not been endorsed yet, so there is nothing for GSO to check." />
    )
  }

  return <ItemsChecklist request={data} />
}

function Problem({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-lg p-10">
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">{message}</p>
      </div>
    </div>
  )
}
