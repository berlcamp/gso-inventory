"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import { StatusBadge } from "@/components/shared/status-badge"
import { RequestStepper } from "@/components/shared/request-stepper"
import { TimelineLog } from "@/components/shared/timeline-log"
import {
  AlertCircle,
  Check,
  Loader2,
  PackageCheck,
  X,
  Ban,
} from "lucide-react"
import { format } from "date-fns"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  approveRequest,
  rejectRequest,
  releaseRequest,
  cancelRequest,
} from "@/lib/actions/requests"
import type { RequestLogRow, SupplyRequestRow } from "@/types/database"

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  )
}

export function RequestDetail({
  request,
  logs,
  balances,
}: {
  request: SupplyRequestRow
  logs: RequestLogRow[]
  balances: Record<string, number>
}) {
  const router = useRouter()
  const { can } = usePermissions()
  const [error, setError] = useState<string | null>(null)

  const lines = request.request_items ?? []
  const isPending = request.status === "pending"
  const isReleasable =
    request.status === "approved" || request.status === "partially_released"

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Status + actions */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={request.status} />
            <div className="flex flex-wrap items-center gap-2">
              {isPending && can("request.approve") && (
                <>
                  <ApproveDialog
                    request={request}
                    balances={balances}
                    onDone={() => router.refresh()}
                    onError={setError}
                  />
                  <RejectDialog
                    requestId={request.id}
                    onDone={() => router.refresh()}
                    onError={setError}
                  />
                </>
              )}
              {isReleasable && can("request.release") && (
                <ReleaseDialog
                  request={request}
                  balances={balances}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
              {isPending && (
                <CancelButton
                  requestId={request.id}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
            </div>
          </div>

          <RequestStepper status={request.status} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Summary */}
        <Card className="lg:col-span-1">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <Detail label="RIS Number" value={<span className="font-mono">{request.request_no}</span>} />
            <Detail
              label="Office"
              value={`${request.office?.code ?? ""} — ${request.office?.name ?? ""}`}
            />
            <Detail
              label="Source"
              value={request.source === "walk_in" ? "Walk-in (over the counter)" : "Filed in system"}
            />
            <Detail
              label="Requested by"
              value={request.requester?.full_name ?? request.requester_name}
            />
            <Detail
              label="Filed"
              value={format(new Date(request.requested_at), "dd MMM yyyy, h:mm a")}
            />
            <Detail label="Purpose" value={request.purpose} />
            {request.remarks && <Detail label="Remarks" value={request.remarks} />}
            {request.reviewer && (
              <Detail
                label="Reviewed by"
                value={`${request.reviewer.full_name}${
                  request.reviewed_at
                    ? ` · ${format(new Date(request.reviewed_at), "dd MMM yyyy")}`
                    : ""
                }`}
              />
            )}
            {request.releaser && (
              <Detail
                label="Released by"
                value={`${request.releaser.full_name}${
                  request.released_at
                    ? ` · ${format(new Date(request.released_at), "dd MMM yyyy")}`
                    : ""
                }`}
              />
            )}
            {request.received_by_name && (
              <Detail label="Received by" value={request.received_by_name} />
            )}
          </CardContent>
        </Card>

        {/* Line items */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Requested Items
            </CardTitle>
            <CardDescription>
              {lines.length} item{lines.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Item
                  </TableHead>
                  <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                    Unit
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Req.
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Appr.
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Released
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Remaining
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id} className="border-border/40">
                    <TableCell>
                      <p className="text-sm font-medium">{line.item?.name ?? "—"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {line.item?.category?.name ?? ""}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {line.item?.unit?.code ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(line.quantity_requested).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.quantity_approved === null
                        ? "—"
                        : Number(line.quantity_approved).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-green-700">
                      {Number(line.quantity_released).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {(balances[line.item_id] ?? 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <TimelineLog entries={logs} />
        </CardContent>
      </Card>
    </div>
  )
}

/* ── Approve ───────────────────────────────────────────────────────────── */

function ApproveDialog({
  request,
  balances,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  balances: Record<string, number>
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = request.request_items ?? []
  const [open, setOpen] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.id, Number(l.quantity_approved ?? l.quantity_requested)])
    )
  )
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleApprove() {
    setSubmitting(true)
    const result = await approveRequest(
      request.id,
      lines.map((l) => ({
        request_item_id: l.id,
        quantity_approved: Number(quantities[l.id] ?? 0),
      })),
      remarks.trim() || undefined
    )
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Request approved. It is now ready for release.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Check className="h-3.5 w-3.5" />
        Approve
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Approve Request</DialogTitle>
          <DialogDescription>
            Adjust quantities if the office asked for more than GSO can grant.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const available = balances[line.item_id] ?? 0
            const value = Number(quantities[line.id] ?? 0)
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
                    Requested {Number(line.quantity_requested).toLocaleString()}{" "}
                    {line.item?.unit?.code} · {available.toLocaleString()} remaining
                  </p>
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={value}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.id]: Number(e.target.value),
                      }))
                    }
                    className={`h-8 text-right tabular-nums ${
                      value > available ? "border-destructive" : ""
                    }`}
                  />
                </div>
              </div>
            )
          })}

          <div className="space-y-1.5 pt-1">
            <Label
              htmlFor="approve-remarks"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Remarks
            </Label>
            <Textarea
              id="approve-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note recorded in the request history"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleApprove} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Approve Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Reject ────────────────────────────────────────────────────────────── */

function RejectDialog({
  requestId,
  onDone,
  onError,
}: {
  requestId: string
  onDone: () => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleReject() {
    if (!remarks.trim()) {
      onError("A reason is required when rejecting a request.")
      return
    }
    setSubmitting(true)
    const result = await rejectRequest(requestId, remarks.trim())
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Request rejected.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <X className="h-3.5 w-3.5" />
        Reject
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Reject Request</DialogTitle>
          <DialogDescription>
            The requesting office sees this reason on the request.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Reason for rejection"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="destructive" onClick={handleReject} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Release ───────────────────────────────────────────────────────────── */

function ReleaseDialog({
  request,
  balances,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  balances: Record<string, number>
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = (request.request_items ?? []).filter((l) => {
    const approved = Number(l.quantity_approved ?? l.quantity_requested)
    return approved - Number(l.quantity_released) > 0
  })

  const [open, setOpen] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((l) => {
        const outstanding =
          Number(l.quantity_approved ?? l.quantity_requested) -
          Number(l.quantity_released)
        const available = balances[l.item_id] ?? 0
        return [l.id, Math.min(outstanding, available)]
      })
    )
  )
  const [receivedBy, setReceivedBy] = useState("")
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleRelease() {
    const payload = lines
      .map((l) => ({
        request_item_id: l.id,
        quantity: Number(quantities[l.id] ?? 0),
      }))
      .filter((l) => l.quantity > 0)

    if (payload.length === 0) {
      onError("Enter at least one quantity to release.")
      return
    }

    setSubmitting(true)
    const result = await releaseRequest(
      request.id,
      payload,
      receivedBy.trim() || undefined,
      remarks.trim() || undefined
    )
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }

    toast.success(
      result.data?.status === "released"
        ? "Fully released. Balances updated."
        : "Partial release recorded. Balances updated."
    )
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PackageCheck className="h-3.5 w-3.5" />
        Record Release
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Record Release</DialogTitle>
          <DialogDescription>
            Deducts from the office&apos;s remaining balance and writes a ledger
            entry. Release less than approved to record a partial issuance.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const outstanding =
              Number(line.quantity_approved ?? line.quantity_requested) -
              Number(line.quantity_released)
            const available = balances[line.item_id] ?? 0
            const value = Number(quantities[line.id] ?? 0)
            const invalid = value > outstanding || value > available

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
                    {outstanding.toLocaleString()} {line.item?.unit?.code} still to
                    issue · {available.toLocaleString()} remaining
                  </p>
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={Math.min(outstanding, available)}
                    step="any"
                    value={value}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.id]: Number(e.target.value),
                      }))
                    }
                    className={`h-8 text-right tabular-nums ${
                      invalid ? "border-destructive" : ""
                    }`}
                  />
                </div>
              </div>
            )
          })}

          <div className="space-y-1.5 pt-1">
            <Label
              htmlFor="received-by"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Received by
            </Label>
            <Input
              id="received-by"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Name of the person collecting the supplies"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="release-remarks"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Remarks
            </Label>
            <Textarea
              id="release-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note recorded against each ledger entry"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleRelease} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record Release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cancel ────────────────────────────────────────────────────────────── */

function CancelButton({
  requestId,
  onDone,
  onError,
}: {
  requestId: string
  onDone: () => void
  onError: (message: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function handleCancel() {
    if (!confirm("Cancel this request? This cannot be undone.")) return
    setSubmitting(true)
    const result = await cancelRequest(requestId)
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Request cancelled.")
    onDone()
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleCancel}
      disabled={submitting}
      className="text-muted-foreground hover:text-destructive"
    >
      {submitting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Ban className="h-3.5 w-3.5" />
      )}
      Cancel
    </Button>
  )
}
