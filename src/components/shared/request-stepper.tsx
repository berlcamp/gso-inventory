import { cn } from "@/lib/utils"
import { Check, X } from "lucide-react"
import type { RequestStatus } from "@/types/database"

const FLOW: { status: RequestStatus; label: string }[] = [
  { status: "awaiting_endorsement", label: "Filed" },
  { status: "pending", label: "Endorsed" },
  { status: "approved", label: "Approved" },
  { status: "released", label: "Released" },
]

/**
 * Terminal states that never reach the end of the happy path. Rejection is not
 * attributed here — either the department head or GSO can reject, and the
 * history below the stepper already names who did and why.
 */
const TERMINAL: Partial<Record<RequestStatus, string>> = {
  rejected: "Rejected",
  cancelled: "Cancelled by the requesting office",
}

export function RequestStepper({ status }: { status: RequestStatus }) {
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

  // partially_released sits between approved and released, so it shows on the
  // "Approved" step rather than as one of its own.
  const currentIndex =
    status === "partially_released"
      ? FLOW.findIndex((s) => s.status === "approved")
      : FLOW.findIndex((s) => s.status === status)

  return (
    <div className="flex items-center">
      {FLOW.map((step, index) => {
        const isDone =
          index < currentIndex ||
          (index === currentIndex && status === "released")
        const isCurrent = index === currentIndex && !isDone

        return (
          <div key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-colors",
                  isDone
                    ? "bg-green-600 text-white ring-green-600"
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
                  isDone || isCurrent
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
