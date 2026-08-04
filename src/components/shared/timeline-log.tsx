import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { getStatusLabel } from "@/components/shared/status-badge"
import type { RequestAction, RequestLogRow } from "@/types/database"

const actionConfig: Record<RequestAction, { dot: string; label: string }> = {
  submitted: { dot: "bg-yellow-500", label: "submitted" },
  endorsed: { dot: "bg-purple-500", label: "endorsed" },
  approved: { dot: "bg-blue-500", label: "approved" },
  rejected: { dot: "bg-red-500", label: "rejected" },
  released: { dot: "bg-green-500", label: "released" },
  received: { dot: "bg-emerald-500", label: "confirmed receipt of" },
  disputed: { dot: "bg-rose-500", label: "reported a discrepancy on" },
  resolved: { dot: "bg-teal-500", label: "resolved a discrepancy on" },
  cancelled: { dot: "bg-slate-400", label: "cancelled" },
  updated: { dot: "bg-violet-500", label: "updated" },
}

export function TimelineLog({ entries }: { entries: RequestLogRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    )
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, index) => {
        const config = actionConfig[entry.action]
        return (
          <div key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn("mt-2.5 h-2 w-2 shrink-0 rounded-full", config.dot)}
              />
              {index < entries.length - 1 && (
                <div className="mt-1.5 w-px flex-1 bg-border/60" />
              )}
            </div>

            <div className="min-w-0 pb-4">
              <p className="text-sm leading-snug">
                <span className="font-semibold text-foreground">
                  {entry.actor?.full_name ?? "System"}
                </span>{" "}
                <span className="text-muted-foreground">{config.label}</span>{" "}
                {entry.request ? (
                  <>
                    <Link
                      href={`/dashboard/requests/${entry.request.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {entry.request.request_no}
                    </Link>
                    {entry.request.office && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({entry.request.office.code})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">this request</span>
                )}{" "}
                <span className="text-muted-foreground">at</span>{" "}
                <span className="font-medium text-foreground">
                  {getStatusLabel(entry.stage)}
                </span>
              </p>
              {entry.remarks && (
                <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                  &ldquo;{entry.remarks}&rdquo;
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(entry.created_at), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
