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
import { Checkbox } from "@/components/ui/checkbox"
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
  ClipboardCheck,
  Loader2,
  PackageCheck,
  Stamp,
  X,
  Ban,
} from "lucide-react"
import { format } from "date-fns"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  approveRequest,
  endorseRequest,
  recommendRequest,
  rejectRequest,
  releaseRequest,
  cancelRequest,
} from "@/lib/actions/requests"
import { rollUpReceipt } from "@/lib/requests/receipt"
import { ReleaseReceipts } from "./release-receipts"
import type {
  ItemAvailability,
  RequestLogRow,
  RequestReleaseRow,
  SupplyRequestRow,
} from "@/types/database"

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
  availability,
  releases,
}: {
  request: SupplyRequestRow
  logs: RequestLogRow[]
  availability: Record<string, ItemAvailability>
  releases: RequestReleaseRow[]
}) {
  const router = useRouter()
  const { can } = usePermissions()
  const [error, setError] = useState<string | null>(null)

  const lines = request.request_items ?? []
  const receipt = rollUpReceipt(releases)
  const isAwaitingEndorsement = request.status === "awaiting_endorsement"
  // `pending` is the GSO checker's desk now — endorsed, quantities not yet
  // checked. Approval only opens once they have recommended it.
  const isPending = request.status === "pending"
  const isRecommended = request.status === "recommended"
  const isReleasable =
    request.status === "approved" || request.status === "partially_released"
  // Withdrawable right up to GSO's approval, at any stage before it.
  const isCancellable = isAwaitingEndorsement || isPending || isRecommended

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
              {isAwaitingEndorsement && can("request.endorse") && (
                <>
                  <EndorseDialog
                    request={request}
                    availability={availability}
                    onDone={() => router.refresh()}
                    onError={setError}
                  />
                  <RejectDialog
                    requestId={request.id}
                    stage="endorsement"
                    onDone={() => router.refresh()}
                    onError={setError}
                  />
                </>
              )}
              {isPending && can("request.recommend") && (
                <RecommendDialog
                  request={request}
                  availability={availability}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
              {isRecommended && can("request.approve") && (
                <ApproveDialog
                  request={request}
                  availability={availability}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
              {(isPending || isRecommended) && can("request.approve") && (
                <RejectDialog
                  requestId={request.id}
                  stage="review"
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
              {isReleasable && can("request.release") && (
                <ReleaseDialog
                  request={request}
                  availability={availability}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
              {isCancellable && (
                <CancelDialog
                  requestId={request.id}
                  onDone={() => router.refresh()}
                  onError={setError}
                />
              )}
            </div>
          </div>

          <RequestStepper status={request.status} receipt={receipt} />

          {/* The head's Approve button is missing here rather than disabled, so
              say why — the request looks stalled otherwise, and the answer is
              that it is waiting on somebody else. */}
          {isPending && can("request.approve") && !can("request.recommend") && (
            <p className="text-xs text-muted-foreground">
              A GSO checker sets the quantities GSO can grant and recommends
              this request. It can be approved once they have.
            </p>
          )}
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
            {/* Over-the-counter issuance was retired in migration 12; only
                pre-existing rows can still carry it. */}
            {request.source === "walk_in" && (
              <Detail label="Source" value="Walk-in (over the counter)" />
            )}
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
            {request.endorser && (
              <Detail
                label="Endorsed by"
                value={`${request.endorser.full_name}${
                  request.endorsed_at
                    ? ` · ${format(new Date(request.endorsed_at), "dd MMM yyyy")}`
                    : ""
                }`}
              />
            )}
            {request.recommender && (
              <Detail
                label="Checked by"
                value={`${request.recommender.full_name}${
                  request.recommended_at
                    ? ` · ${format(new Date(request.recommended_at), "dd MMM yyyy")}`
                    : ""
                }`}
              />
            )}
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
                  {/* Four signatures, four numbers: filed, endorsed by the
                      office's head, recommended by the GSO checker, approved by
                      the GSO head. Keeping them apart is what makes a raised or
                      trimmed line attributable to whoever moved it. */}
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    End.
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Rec.
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
                      {line.quantity_endorsed === null
                        ? "—"
                        : Number(line.quantity_endorsed).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.quantity_recommended === null
                        ? "—"
                        : Number(line.quantity_recommended).toLocaleString()}
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
                      {(availability[line.item_id]?.balance ?? 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Releases — the two-party record of what physically changed hands */}
      <ReleaseReceipts releases={releases} requestOfficeId={request.office_id} />

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

/* ── Endorse ───────────────────────────────────────────────────────────── */

/**
 * The department head's sign-off, at the quantities they stand behind.
 *
 * The only stage that can raise a line: the head knows what their office needs
 * and the supply officer can have got it wrong either way. The cap is what the
 * office can still draw — anything above that is stock GSO does not have, so
 * the input flags it and the action refuses it.
 */
function EndorseDialog({
  request,
  availability,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  availability: Record<string, ItemAvailability>
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = request.request_items ?? []
  const [open, setOpen] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        Number(l.quantity_endorsed ?? l.quantity_requested),
      ])
    )
  )
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleEndorse() {
    setSubmitting(true)
    const result = await endorseRequest(
      request.id,
      lines.map((l) => ({
        request_item_id: l.id,
        quantity_endorsed: Number(quantities[l.id] ?? 0),
      })),
      remarks.trim() || undefined
    )
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Request endorsed. GSO can now review it.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Stamp className="h-3.5 w-3.5" />
        Endorse to GSO
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Endorse Request</DialogTitle>
          <DialogDescription>
            Set the quantities your office stands behind — raise or lower any
            line, up to what the office has left. GSO checks these figures and
            can only cut them from here.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const stock = availability[line.item_id]
            const available = stock?.available ?? 0
            const committed = stock?.committed ?? 0
            const requested = Number(line.quantity_requested)
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
                    Filed {requested.toLocaleString()} {line.item?.unit?.code} ·{" "}
                    {available.toLocaleString()} available
                  </p>
                  {committed > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      {(stock?.balance ?? 0).toLocaleString()} in balance, but{" "}
                      {committed.toLocaleString()} is already approved for
                      release on other requests
                    </p>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={available}
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
              htmlFor="endorse-remarks"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Remarks
            </Label>
            <Textarea
              id="endorse-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note recorded in the request history"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleEndorse} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Endorse to GSO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Recommend ─────────────────────────────────────────────────────────── */

/**
 * The GSO checker's pass: cut each line to what GSO can actually grant, then
 * send it up to the head.
 *
 * The inputs cap at the **endorsed** quantity — the checker reduces, never
 * adds, and the head of the requesting office already had their say on the
 * figure — and flag anything above what the office has left, because a
 * recommendation the GSO head cannot approve is a round trip nobody needs. The
 * action enforces both, and a CHECK constraint enforces the first whatever the
 * client sends.
 */
function RecommendDialog({
  request,
  availability,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  availability: Record<string, ItemAvailability>
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = request.request_items ?? []
  const [open, setOpen] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        Number(
          l.quantity_recommended ?? l.quantity_endorsed ?? l.quantity_requested
        ),
      ])
    )
  )
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleRecommend() {
    setSubmitting(true)
    const result = await recommendRequest(
      request.id,
      lines.map((l) => ({
        request_item_id: l.id,
        quantity_recommended: Number(quantities[l.id] ?? 0),
      })),
      remarks.trim() || undefined
    )
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Recommended for approval. The GSO head can now approve it.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <ClipboardCheck className="h-3.5 w-3.5" />
        Recommend Approval
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Recommend for Approval</DialogTitle>
          <DialogDescription>
            Cut each line to what GSO can grant. You cannot raise a quantity
            above what the requesting office endorsed. The GSO head approves
            from these figures.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const stock = availability[line.item_id]
            const available = stock?.available ?? 0
            const committed = stock?.committed ?? 0
            // Null on a request endorsed before migration 17 — there the filed
            // figure is what the head signed off on.
            const endorsed = Number(
              line.quantity_endorsed ?? line.quantity_requested
            )
            const value = Number(quantities[line.id] ?? 0)
            const invalid = value > endorsed || value > available

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
                    Endorsed {endorsed.toLocaleString()}{" "}
                    {line.item?.unit?.code} · {available.toLocaleString()}{" "}
                    available
                  </p>
                  {committed > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      {(stock?.balance ?? 0).toLocaleString()} in balance, but{" "}
                      {committed.toLocaleString()} is already approved for
                      release on other requests
                    </p>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={endorsed}
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
              htmlFor="recommend-remarks"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Remarks
            </Label>
            <Textarea
              id="recommend-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note recorded in the request history"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleRecommend} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Recommend Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Approve ───────────────────────────────────────────────────────────── */

function ApproveDialog({
  request,
  availability,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  availability: Record<string, ItemAvailability>
  onDone: () => void
  onError: (message: string) => void
}) {
  const lines = request.request_items ?? []
  const [open, setOpen] = useState(false)
  // The recommendation is the starting point *and* the ceiling — approving is
  // now a decision about the checked figures, not the filed ones.
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        Number(l.quantity_approved ?? l.quantity_recommended ?? 0),
      ])
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
            These are the quantities the GSO checker recommended. You can cut
            them further, but not raise them.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto py-4">
          {lines.map((line) => {
            const stock = availability[line.item_id]
            // Approving is a promise, so it is capped by what other approved
            // requests have not already spoken for — and, above that, by what
            // the checker recommended.
            const available = stock?.available ?? 0
            const committed = stock?.committed ?? 0
            const recommended = Number(
              line.quantity_recommended ??
                line.quantity_endorsed ??
                line.quantity_requested
            )
            const ceiling = Math.min(recommended, available)
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
                    {line.item?.unit?.code} · {recommended.toLocaleString()}{" "}
                    recommended · {available.toLocaleString()} available
                  </p>
                  {committed > 0 && (
                    // Without this the number looks wrong: the ledger says one
                    // thing, the approvable figure another.
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      {(stock?.balance ?? 0).toLocaleString()} in balance, but{" "}
                      {committed.toLocaleString()} is already approved for
                      release on other requests
                    </p>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={ceiling}
                    step="any"
                    value={value}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.id]: Number(e.target.value),
                      }))
                    }
                    className={`h-8 text-right tabular-nums ${
                      value > ceiling ? "border-destructive" : ""
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
  stage,
  onDone,
  onError,
}: {
  requestId: string
  /** Who is rejecting — only changes the wording, the action is the same. */
  stage: "endorsement" | "review"
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
            {stage === "endorsement"
              ? "This request will not be sent to GSO. Your supply officer sees this reason and can file a corrected request."
              : "The requesting office sees this reason on the request."}
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
  availability,
  onDone,
  onError,
}: {
  request: SupplyRequestRow
  availability: Record<string, ItemAvailability>
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
        const available = availability[l.item_id]?.balance ?? 0
        return [l.id, Math.min(outstanding, available)]
      })
    )
  )
  const [receivedBy, setReceivedBy] = useState("")
  const [certified, setCertified] = useState(false)
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
    // Naming the receiver is half of the two-party record — the receiving
    // office's confirmation has to have someone to point at. The RPC refuses a
    // blank one too; this only spares a round trip.
    if (!receivedBy.trim()) {
      onError("Name the person collecting the supplies.")
      return
    }

    setSubmitting(true)
    const result = await releaseRequest(
      request.id,
      payload,
      receivedBy.trim(),
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
            // Issuing is capped by the raw balance, not by `available`:
            // `release_request` checks the allocation row itself, and this
            // request's own approved quantity is part of what other requests
            // see as committed. Capping lower here would block a valid release.
            const available = availability[line.item_id]?.balance ?? 0
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
              Received by <span className="text-destructive">*</span>
            </Label>
            <Input
              id="received-by"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Name of the person collecting the supplies"
            />
            <p className="text-xs text-muted-foreground">
              Their office confirms this delivery separately — someone other
              than you has to sign that it arrived.
            </p>
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

        {/* Recording a release was already an assertion under this user's name;
            saying so out loud is what makes it a signature rather than a
            side effect of filling in a form. */}
        <label className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
          <Checkbox
            checked={certified}
            onCheckedChange={(value) => setCertified(value === true)}
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I certify that the items and quantities above were physically issued
            to the person named, and that this is recorded under my name.
          </span>
        </label>

        <DialogFooter>
          <Button onClick={handleRelease} disabled={submitting || !certified}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record Release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cancel ────────────────────────────────────────────────────────────── */

/**
 * Cancellation is terminal and there is no edit-and-resubmit flow, so the
 * reason is the only record of why a slip stopped — required here for the same
 * reason `RejectDialog` requires one. The server enforces it too; this check
 * only spares a round trip.
 */
function CancelDialog({
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

  async function handleCancel() {
    if (!remarks.trim()) {
      onError("A reason is required when cancelling a request.")
      return
    }
    setSubmitting(true)
    const result = await cancelRequest(requestId, remarks.trim())
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Request cancelled.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Ban className="h-3.5 w-3.5" />
        Cancel
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Cancel Request</DialogTitle>
          <DialogDescription>
            This cannot be undone — a corrected slip has to be filed as a new
            request. The reason is recorded on the request&rsquo;s timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Reason for cancellation"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Cancel Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
