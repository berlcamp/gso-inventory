import { cn } from "@/lib/utils"
import { RECEIPT_LABEL, type ReceiptState } from "@/lib/requests/receipt"
import type { RequestStatus, MovementType } from "@/types/database"

const statusConfig: Record<
  RequestStatus,
  { label: string; dot: string; className: string }
> = {
  awaiting_endorsement: {
    label: "For Endorsement",
    dot: "bg-purple-500",
    className: "bg-purple-50 text-purple-800 ring-1 ring-purple-200",
  },
  pending: {
    label: "For GSO Review",
    dot: "bg-yellow-500",
    className: "bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200",
  },
  recommended: {
    label: "For Approval",
    dot: "bg-teal-500",
    className: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
  },
  approved: {
    label: "Approved",
    dot: "bg-blue-500",
    className: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
  },
  partially_released: {
    label: "Partially Released",
    dot: "bg-orange-500",
    className: "bg-orange-50 text-orange-800 ring-1 ring-orange-200",
  },
  released: {
    label: "Released",
    dot: "bg-green-500",
    className: "bg-green-50 text-green-800 ring-1 ring-green-200",
  },
  rejected: {
    label: "Rejected",
    dot: "bg-red-500",
    className: "bg-red-50 text-red-800 ring-1 ring-red-200",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-slate-400",
    className: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
  },
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const config = statusConfig[status]
  if (!config) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        config.className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", config.dot)} />
      {config.label}
    </span>
  )
}

export function getStatusLabel(status: RequestStatus): string {
  return statusConfig[status]?.label ?? status
}

/**
 * Where a release — or a whole request, once rolled up — stands with the office
 * that received it. Deliberately a *second* badge rather than more values on
 * the status one: issuance and acknowledgement are two different questions, and
 * a slip can be fully released and still unsigned for.
 */
const receiptConfig: Record<ReceiptState, { dot: string; className: string }> = {
  none: {
    dot: "bg-slate-300",
    className: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  },
  pending: {
    dot: "bg-amber-500",
    className: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  },
  disputed: {
    dot: "bg-rose-500",
    className: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  },
  confirmed: {
    dot: "bg-emerald-500",
    className: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  },
  waived: {
    dot: "bg-slate-400",
    className: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
  },
}

export function ReceiptBadge({ state }: { state: ReceiptState }) {
  const config = receiptConfig[state]
  if (!config) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        config.className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", config.dot)} />
      {RECEIPT_LABEL[state]}
    </span>
  )
}

const movementConfig: Record<
  MovementType,
  { label: string; className: string }
> = {
  opening: {
    label: "Opening",
    className: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
  },
  release: {
    label: "Release",
    className: "bg-red-50 text-red-700 ring-1 ring-red-200",
  },
  replenishment: {
    label: "Replenishment",
    className: "bg-green-50 text-green-700 ring-1 ring-green-200",
  },
  return: {
    label: "Return",
    className: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  },
  adjustment: {
    label: "Adjustment",
    className: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  },
}

export function MovementBadge({ type }: { type: MovementType }) {
  const config = movementConfig[type]
  if (!config) return null
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        config.className
      )}
    >
      {config.label}
    </span>
  )
}

export function getMovementLabel(type: MovementType): string {
  return movementConfig[type]?.label ?? type
}
