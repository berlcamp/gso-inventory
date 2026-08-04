"use client"

/**
 * The two-party record of what actually left the counter.
 *
 * One card per release — per *trip*, not per request, because a request can be
 * handed over in several batches and each is signed for on its own. GSO's half
 * of the signature is the release itself; this is where the receiving office
 * adds theirs, or says the quantities were wrong.
 *
 * Reporting a discrepancy moves no stock. It records what the office counted
 * and flags the release for GSO, who reconciles the balance with a stock
 * adjustment — so the ledger keeps exactly one author and a shortfall shows up
 * as a visible correction instead of a department editing inventory.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ReceiptBadge } from "@/components/shared/status-badge"
import {
  AlertCircle,
  CheckCheck,
  Info,
  Loader2,
  TriangleAlert,
  Wrench,
} from "lucide-react"
import { useSession } from "@/lib/hooks/use-session"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  acknowledgeRelease,
  resolveReleaseDispute,
} from "@/lib/actions/requests"
import { releaseAckEligibility, type ReceiptViewer } from "@/lib/requests/receipt"
import type { RequestReleaseRow } from "@/types/database"

const qty = (value: number) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })

export function ReleaseReceipts({
  releases,
  requestOfficeId,
}: {
  releases: RequestReleaseRow[]
  requestOfficeId: string
}) {
  const { session } = useSession()
  const { can } = usePermissions()
  const [error, setError] = useState<string | null>(null)

  // Nothing has been issued yet — an empty "Releases" card would just be noise
  // on a slip that is still waiting for approval.
  if (releases.length === 0) return null

  const viewer: ReceiptViewer = {
    userId: session?.userId ?? "",
    officeIds: session?.officeIds ?? [],
    canAcknowledge: can("request.acknowledge"),
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Releases &amp; Receipt
        </CardTitle>
        <CardDescription>
          Every handover is signed twice — by GSO when the supplies go out, and
          by the receiving office when they arrive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {releases.map((release, index) => (
          <ReleaseCard
            key={release.id}
            release={release}
            index={index}
            total={releases.length}
            requestOfficeId={requestOfficeId}
            viewer={viewer}
            // Settling a discrepancy is GSO's job — the same desk that issued
            // the goods and that will make any corrective stock adjustment.
            canResolve={can("request.release")}
            onError={setError}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function ReleaseCard({
  release,
  index,
  total,
  requestOfficeId,
  viewer,
  canResolve,
  onError,
}: {
  release: RequestReleaseRow
  index: number
  total: number
  requestOfficeId: string
  viewer: ReceiptViewer
  canResolve: boolean
  onError: (message: string | null) => void
}) {
  const router = useRouter()
  const lines = release.request_release_items ?? []
  const eligibility = releaseAckEligibility(release, requestOfficeId, viewer)
  const isAcknowledged =
    release.ack_status === "confirmed" || release.ack_status === "disputed"

  return (
    <div className="rounded-xl border border-border/60">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 bg-muted/20 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {total > 1 ? `Release ${index + 1} of ${total}` : "Release"}
            <span className="ml-2 font-normal text-muted-foreground">
              {format(new Date(release.released_at), "dd MMM yyyy, h:mm a")}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Issued by{" "}
            <span className="font-medium text-foreground">
              {release.releaser?.full_name ?? "—"}
            </span>
            {release.received_by_name && (
              <>
                {" · handed to "}
                <span className="font-medium text-foreground">
                  {release.received_by_name}
                </span>
              </>
            )}
          </p>
        </div>
        <ReceiptBadge state={release.ack_status} />
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-b border-border/50 hover:bg-transparent">
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Item
            </TableHead>
            <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
              Unit
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Issued
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Received
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const short =
              line.quantity_received !== null &&
              Number(line.quantity_received) !== Number(line.quantity_issued)

            return (
              <TableRow key={line.id} className="border-border/40">
                <TableCell className="text-sm font-medium">
                  {line.item?.name ?? "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {line.item?.unit?.code ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {qty(line.quantity_issued)}
                </TableCell>
                <TableCell
                  className={
                    short
                      ? "text-right font-semibold tabular-nums text-rose-700"
                      : "text-right tabular-nums text-muted-foreground"
                  }
                >
                  {line.quantity_received === null
                    ? "—"
                    : qty(line.quantity_received)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="border-t border-border/50 px-4 py-3">
        {isAcknowledged ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {release.ack_status === "disputed"
                ? "Discrepancy reported by "
                : "Receipt confirmed by "}
              <span className="font-medium text-foreground">
                {release.acknowledger?.full_name ?? "—"}
              </span>
              {release.acknowledged_at && (
                <>
                  {" · "}
                  {format(
                    new Date(release.acknowledged_at),
                    "dd MMM yyyy, h:mm a"
                  )}
                </>
              )}
            </p>
            {release.ack_remarks && (
              <p className="max-w-2xl text-xs text-muted-foreground">
                &ldquo;{release.ack_remarks}&rdquo;
              </p>
            )}
            {release.ack_status === "disputed" &&
              (release.dispute_resolved_at ? (
                <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
                  <p className="text-xs text-teal-900">
                    Settled by{" "}
                    <span className="font-medium">
                      {release.resolver?.full_name ?? "GSO"}
                    </span>
                    {" · "}
                    {format(
                      new Date(release.dispute_resolved_at),
                      "dd MMM yyyy, h:mm a"
                    )}
                  </p>
                  {release.dispute_resolution && (
                    <p className="mt-0.5 text-xs text-teal-800">
                      &ldquo;{release.dispute_resolution}&rdquo;
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  <p className="flex items-start gap-1.5 text-xs text-rose-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Balances were not changed. GSO settles the difference with a
                    stock adjustment.
                  </p>
                  {canResolve && (
                    <ResolveDisputeDialog
                      release={release}
                      onDone={() => {
                        onError(null)
                        router.refresh()
                      }}
                      onError={onError}
                    />
                  )}
                </div>
              ))}
          </div>
        ) : release.ack_status === "waived" ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {release.ack_remarks ??
              "Issued before receipt confirmation was introduced."}
          </p>
        ) : eligibility.canAcknowledge ? (
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmReceiptDialog
              release={release}
              onDone={() => {
                onError(null)
                router.refresh()
              }}
              onError={onError}
            />
            <DisputeReleaseDialog
              release={release}
              onDone={() => {
                onError(null)
                router.refresh()
              }}
              onError={onError}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {eligibility.reason ?? "Waiting for the receiving office to confirm."}
          </p>
        )}
      </div>
    </div>
  )
}

/* ── Confirm ───────────────────────────────────────────────────────────── */

function ConfirmReceiptDialog({
  release,
  onDone,
  onError,
}: {
  release: RequestReleaseRow
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = release.request_release_items ?? []
  const [open, setOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    // No `lines`: confirming means every quantity is exactly as issued, and
    // saying so explicitly beats echoing back numbers the server already has.
    const result = await acknowledgeRelease({
      release_id: release.id,
      dispute: false,
      remarks: remarks.trim() || null,
    })
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      setOpen(false)
      return
    }
    toast.success("Receipt confirmed.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <CheckCheck className="h-3.5 w-3.5" />
        Confirm Receipt
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Confirm Receipt</DialogTitle>
          <DialogDescription>
            You are signing that these items and quantities were physically
            delivered to your office. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[40vh] space-y-2 overflow-y-auto py-2">
          {lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
            >
              <p className="min-w-0 truncate text-sm font-medium">
                {line.item?.name ?? "—"}
              </p>
              <p className="shrink-0 text-sm tabular-nums">
                {qty(line.quantity_issued)}{" "}
                <span className="text-xs text-muted-foreground">
                  {line.item?.unit?.code}
                </span>
              </p>
            </div>
          ))}

          <div className="space-y-1.5 pt-1">
            <Label
              htmlFor={`confirm-remarks-${release.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Remarks
            </Label>
            <Textarea
              id={`confirm-remarks-${release.id}`}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional — recorded on the request's timeline"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirm Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Resolve ───────────────────────────────────────────────────────────── */

/**
 * GSO's answer to a reported discrepancy — the step that lets a dispute end.
 *
 * The release stays marked disputed afterwards; this records that it was dealt
 * with and by whom. Correcting the balance, if it needs correcting, is a
 * separate and deliberate stock adjustment.
 */
function ResolveDisputeDialog({
  release,
  onDone,
  onError,
}: {
  release: RequestReleaseRow
  onDone: () => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [resolution, setResolution] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleResolve() {
    if (!resolution.trim()) {
      onError("Record how the discrepancy was settled.")
      return
    }

    setSubmitting(true)
    const result = await resolveReleaseDispute(release.id, resolution.trim())
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      setOpen(false)
      return
    }
    toast.success("Discrepancy resolved.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Wrench className="h-3.5 w-3.5" />
        Record Resolution
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Resolve Discrepancy</DialogTitle>
          <DialogDescription>
            The release stays on record as disputed — this notes how it was
            settled and closes it on GSO&rsquo;s queue. If the balance needs
            correcting, make that stock adjustment separately.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="How it was settled — e.g. two reams delivered the next day, balance adjusted"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleResolve} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record Resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Dispute ───────────────────────────────────────────────────────────── */

function DisputeReleaseDialog({
  release,
  onDone,
  onError,
}: {
  release: RequestReleaseRow
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = release.request_release_items ?? []
  const [open, setOpen] = useState(false)
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, Number(l.quantity_issued)]))
  )
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const changed = lines.some(
    (l) => Number(received[l.id] ?? 0) !== Number(l.quantity_issued)
  )

  async function handleDispute() {
    if (!changed) {
      onError(
        "Every quantity still matches what was issued — use Confirm Receipt instead."
      )
      return
    }
    if (!remarks.trim()) {
      onError("Describe the discrepancy before reporting it.")
      return
    }

    setSubmitting(true)
    const result = await acknowledgeRelease({
      release_id: release.id,
      dispute: true,
      remarks: remarks.trim(),
      lines: lines.map((l) => ({
        release_item_id: l.id,
        quantity_received: Number(received[l.id] ?? 0),
      })),
    })
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      setOpen(false)
      return
    }
    toast.success("Discrepancy reported. GSO has been notified.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <TriangleAlert className="h-3.5 w-3.5" />
        Report Discrepancy
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Report a Discrepancy</DialogTitle>
          <DialogDescription>
            Record what actually arrived. Balances are not changed by this —
            GSO reviews the report and settles the difference with a stock
            adjustment, so the correction stays on the record.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const value = Number(received[line.id] ?? 0)
            const differs = value !== Number(line.quantity_issued)

            return (
              <div
                key={line.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {line.item?.name ?? "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {qty(line.quantity_issued)} {line.item?.unit?.code} issued
                  </p>
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={value}
                    onChange={(e) =>
                      setReceived((prev) => ({
                        ...prev,
                        [line.id]: Number(e.target.value),
                      }))
                    }
                    className={`h-8 text-right tabular-nums ${
                      differs ? "border-amber-500" : ""
                    }`}
                  />
                </div>
              </div>
            )
          })}

          <div className="space-y-1.5 pt-1">
            <Label
              htmlFor={`dispute-remarks-${release.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              What was wrong?
            </Label>
            <Textarea
              id={`dispute-remarks-${release.id}`}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Required — e.g. two reams were short, one box was damaged"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleDispute}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Report Discrepancy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
