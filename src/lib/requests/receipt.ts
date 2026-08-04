/**
 * Where a request stands with the offices that received its goods.
 *
 * Acknowledgement lives on the **release**, not the request — a request can be
 * handed over across several trips, and each one is signed for separately. The
 * list and the dashboard still need one word per request, so this rolls the
 * releases up; the detail page shows them individually.
 *
 * Plain module, deliberately not `"use server"` — same split as
 * `inventory/availability.ts` and `notifications/feed.ts`. That is what lets
 * the server actions, the table column, and `receipt.test.ts` share one
 * definition of "confirmed" instead of three that drift.
 */

import type { ReleaseAckStatus, RequestRelease } from "@/types/database"

export type ReceiptState =
  /** Nothing has been issued yet, so there is nothing to sign for. */
  | "none"
  /** At least one release is waiting on the receiving office. */
  | "pending"
  /** At least one release came back with quantities that did not match. */
  | "disputed"
  /** Every release that could be signed for has been. */
  | "confirmed"
  /** Issued before confirmation existed — nobody ever signed, nobody can. */
  | "waived"

/**
 * Worst-first, because this is an exception report before it is a status: a
 * request with one disputed release and four confirmed ones is a disputed
 * request. `waived` ranks last so a pre-feature release never masks a real
 * confirmation on the same slip.
 */
const PRECEDENCE: ReleaseAckStatus[] = [
  "disputed",
  "pending",
  "confirmed",
  "waived",
]

export function rollUpReceipt(
  releases: Pick<RequestRelease, "ack_status">[] | null | undefined
): ReceiptState {
  if (!releases || releases.length === 0) return "none"

  const present = new Set(releases.map((r) => r.ack_status))
  for (const status of PRECEDENCE) {
    if (present.has(status)) return status
  }
  return "none"
}

export const RECEIPT_LABEL: Record<ReceiptState, string> = {
  none: "Nothing issued",
  pending: "Awaiting confirmation",
  disputed: "Discrepancy reported",
  confirmed: "Receipt confirmed",
  waived: "No confirmation on record",
}

/** For the requests table's filter — `none` is the default and not worth a chip. */
export const RECEIPT_FILTER_OPTIONS = (
  ["pending", "disputed", "confirmed", "waived"] as const
).map((value) => ({ label: RECEIPT_LABEL[value], value }))

export interface ReceiptViewer {
  userId: string
  officeId: string | null
  canAcknowledge: boolean
}

export interface AckEligibility {
  canAcknowledge: boolean
  /**
   * Why not, phrased for the person reading it. Null when they can act, or
   * when the release is already resolved and the UI shows that instead.
   */
  reason: string | null
}

/**
 * Whether this viewer may sign for this release, and if not, why.
 *
 * A mirror of the checks inside the `acknowledge_release` RPC, which is the
 * authority — this exists so the page can explain itself rather than silently
 * hiding a button. Every rule here is enforced again server-side.
 */
export function releaseAckEligibility(
  release: Pick<RequestRelease, "ack_status" | "released_by">,
  requestOfficeId: string,
  viewer: ReceiptViewer
): AckEligibility {
  if (release.ack_status !== "pending") {
    return { canAcknowledge: false, reason: null }
  }
  if (!viewer.canAcknowledge || !viewer.officeId) {
    return {
      canAcknowledge: false,
      reason:
        "Only the receiving office's supply officer or department head can confirm a release.",
    }
  }
  if (viewer.officeId !== requestOfficeId) {
    return {
      canAcknowledge: false,
      reason: "Only the office that received these supplies can confirm them.",
    }
  }
  // The two-man rule, and the reason this feature is worth having: one person
  // must not be able to both hand goods over and sign that they arrived.
  if (release.released_by && release.released_by === viewer.userId) {
    return {
      canAcknowledge: false,
      reason:
        "You recorded this release, so someone else has to confirm it arrived.",
    }
  }
  return { canAcknowledge: true, reason: null }
}
