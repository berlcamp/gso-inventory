/**
 * The printable delivery receipt for one release.
 *
 * Deliberately outside `/dashboard`: that layout wraps every page in the
 * sidebar and topbar, and hiding app chrome with print rules means the
 * *screen* still shows a receipt sitting inside the app — which is exactly the
 * thing a person is about to hand across a counter and sign. A separate route
 * gets a clean sheet on screen and on paper for free, and it opens in its own
 * tab, so printing never takes the custodian off the request they were working.
 *
 * `src/proxy.ts` guards this prefix the same way it guards `/dashboard`, and
 * `getReleaseForReceipt` re-checks visibility server-side — the release id in
 * the URL grants nothing on its own.
 */

import { notFound } from "next/navigation"
import { getReleaseForReceipt } from "@/lib/actions/requests"
import { DeliveryReceipt } from "./delivery-receipt"

export const dynamic = "force-dynamic"

export default async function DeliveryReceiptPage({
  params,
}: {
  params: Promise<{ releaseId: string }>
}) {
  const { releaseId } = await params
  const { data, error } = await getReleaseForReceipt(releaseId)

  if (!data) {
    if (error === "Release not found.") notFound()
    return (
      <div className="mx-auto max-w-lg p-10">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm font-medium text-destructive">
            {error ?? "Could not load this delivery receipt."}
          </p>
        </div>
      </div>
    )
  }

  return <DeliveryReceipt data={data} />
}
