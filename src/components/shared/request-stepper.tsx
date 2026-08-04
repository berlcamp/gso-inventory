import { cn } from "@/lib/utils"
import { Check, X } from "lucide-react"
import type { ReceiptState } from "@/lib/requests/receipt"
import type { RequestStatus } from "@/types/database"

/**
 * "Received" is the one step that is **not** a request status. Acknowledgement
 * lives on each release, so a request is received when every release has been
 * signed for — a fifth status would have had to mean "released and all
 * batches confirmed", which is two facts wearing one label.
 */
const FLOW = [
  { key: "filed", label: "Filed" },
  { key: "endorsed", label: "Endorsed" },
  { key: "approved", label: "Approved" },
  { key: "released", label: "Released" },
  { key: "received", label: "Received" },
] as const

const STATUS_INDEX: Partial<Record<RequestStatus, number>> = {
  awaiting_endorsement: 0,
  pending: 1,
  approved: 2,
  // Sits between approved and released, so it shows on the "Approved" step
  // rather than as one of its own.
  partially_released: 2,
  released: 3,
}

/**
 * Terminal states that never reach the end of the happy path. Rejection is not
 * attributed here — either the department head or GSO can reject, and the
 * history below the stepper already names who did and why.
 */
const TERMINAL: Partial<Record<RequestStatus, string>> = {
  rejected: "Rejected",
  cancelled: "Cancelled by the requesting office",
}

export function RequestStepper({
  status,
  receipt = "none",
}: {
  status: RequestStatus
  receipt?: ReceiptState
}) {
  const terminalLabel = TERMINAL[status]

  if (terminalLabel) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <X className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-medium text-destructive">{terminalLabel}</p>
      </div>
    )
  }

  const statusIndex = STATUS_INDEX[status] ?? 0
  const isReleased = status === "released"
  const isReceived = isReleased && receipt === "confirmed"

  // Once everything is out the door the open question is the receipt, so the
  // cursor moves to the last step and stays there until the office that got the
  // goods says they arrived.
  const currentIndex = isReleased ? 4 : statusIndex

  return (
    <div className="flex items-center">
      {FLOW.map((step, index) => {
        const isReceiptStep = index === 4
        const disputed = isReceiptStep && receipt === "disputed"
        // A release nobody could ever sign for is not progress, but it is also
        // not work anyone can do — grey, with the reason spelled out.
        const unsignable = isReceiptStep && receipt === "waived"

        const isDone = isReceiptStep
          ? isReceived
          : index < currentIndex || (index === statusIndex && isReleased)
        const isCurrent = !isDone && !unsignable && index === currentIndex

        return (
          <div key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-colors",
                  isDone
                    ? "bg-green-600 text-white ring-green-600"
                    : disputed
                    ? "bg-rose-50 text-rose-700 ring-rose-300"
                    : isCurrent
                    ? "bg-amber-50 text-amber-700 ring-amber-300"
                    : "bg-muted text-muted-foreground ring-border"
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-medium whitespace-nowrap",
                  isDone || isCurrent || disputed
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {step.label}
                {isCurrent && status === "partially_released" && (
                  <span className="ml-1.5 text-xs font-normal text-orange-600">
                    (partially released)
                  </span>
                )}
                {disputed && (
                  <span className="ml-1.5 text-xs font-normal text-rose-600">
                    (discrepancy)
                  </span>
                )}
                {unsignable && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    (not recorded)
                  </span>
                )}
              </span>
            </div>

            {index < FLOW.length - 1 && (
              <div
                className={cn(
                  "mx-3 h-px flex-1 min-w-6",
                  index < currentIndex ? "bg-green-500/50" : "bg-border"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
