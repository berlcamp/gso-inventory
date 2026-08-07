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
 *
 * **Voiding is the other direction and does move stock**, because it is GSO
 * correcting GSO: a line recorded as issued that never left the warehouse. It
 * restores the balance, reopens the slip for that quantity, and writes both a
 * ledger row and a timeline entry. The issued figure stays on screen beside the
 * voided one — a void is a correction on the record, not a redraft of it.
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
  Printer,
  RotateCcw,
  TriangleAlert,
  Wrench,
} from "lucide-react"
import { useSession } from "@/lib/hooks/use-session"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  acknowledgeRelease,
  resolveReleaseDispute,
  voidReleaseItem,
} from "@/lib/actions/requests"
import { releaseAckEligibility, type ReceiptViewer } from "@/lib/requests/receipt"
import type {
  RequestReleaseItemRow,
  RequestReleaseRow,
} from "@/types/database"

const qty = (value: number) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })

/**
 * What actually left the warehouse on this line.
 *
 * `quantity_issued` is what the custodian wrote down; a void is GSO saying
 * some of it never went out. **This is the only figure the receiving office
 * should ever be shown or asked to sign against** — `acknowledge_release`
 * compares against exactly this, so a dialog using the raw issued quantity
 * would invite a signature the RPC then reads as a discrepancy.
 */
const netIssued = (line: RequestReleaseItemRow) =>
  Number(line.quantity_issued) - Number(line.quantity_voided ?? 0)

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
            // Its own permission, not `request.release`: recording an issuance
            // and unrecording one are different powers, and an LGU that wants
            // voids held only by the GSO head revokes a role permission rather
            // than changing this file.
            canVoid={can("request.void_release")}
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
  canVoid,
  onError,
}: {
  release: RequestReleaseRow
  index: number
  total: number
  requestOfficeId: string
  viewer: ReceiptViewer
  canResolve: boolean
  canVoid: boolean
  onError: (message: string | null) => void
}) {
  const router = useRouter()
  const lines = release.request_release_items ?? []
  const eligibility = releaseAckEligibility(release, requestOfficeId, viewer)
  const isAcknowledged =
    release.ack_status === "confirmed" || release.ack_status === "disputed"

  // The column only appears once there is something in it. A void is rare, and
  // an always-present empty column would imply otherwise on every receipt.
  const anyVoided = lines.some((line) => Number(line.quantity_voided ?? 0) > 0)

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
        <div className="flex shrink-0 items-center gap-2">
          {/* Its own tab, so printing never takes the custodian off the request
              they were working — and so the sheet on screen is the sheet that
              comes out of the printer, with no app chrome around it. */}
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={`/print/delivery-receipt/${release.id}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <Printer className="h-3.5 w-3.5" />
            Delivery Receipt
          </Button>
          <ReceiptBadge state={release.ack_status} />
        </div>
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
            {anyVoided && (
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Voided
              </TableHead>
            )}
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Received
            </TableHead>
            {canVoid && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const voided = Number(line.quantity_voided ?? 0)
            // Flagged against the *net* figure, the same one the RPC judges a
            // mismatch by. A correct receipt of 7 against 10 issued and 3
            // voided is not short, and colouring it red would be telling the
            // office it got the arithmetic wrong when GSO did.
            const short =
              line.quantity_received !== null &&
              Number(line.quantity_received) !== netIssued(line)
            const voidable = Number(line.quantity_issued) - voided

            return (
              <TableRow key={line.id} className="border-border/40">
                <TableCell className="text-sm font-medium">
                  {line.item?.name ?? "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {line.item?.unit?.code ?? "—"}
                </TableCell>
                {/* The custodian's original figure, never rewritten. A void
                    sits beside it so the record can still say a mistake was
                    made; overwriting this would erase that. */}
                <TableCell
                  className={
                    voidable <= 0
                      ? "text-right tabular-nums text-muted-foreground line-through"
                      : "text-right tabular-nums"
                  }
                >
                  {qty(line.quantity_issued)}
                </TableCell>
                {anyVoided && (
                  <TableCell className="text-right tabular-nums">
                    {voided > 0 ? (
                      <span className="font-semibold text-amber-700">
                        −{qty(voided)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
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
                {canVoid && (
                  <TableCell className="text-right">
                    {voidable > 0 && (
                      <VoidLineDialog
                        line={line}
                        voidable={voidable}
                        onDone={() => {
                          onError(null)
                          router.refresh()
                        }}
                        onError={onError}
                      />
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {anyVoided && (
        <div className="border-t border-border/50 bg-amber-50/40 px-4 py-2">
          <p className="flex items-start gap-1.5 text-xs text-amber-900">
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Voided quantities were returned to the office&rsquo;s balance and
            are outstanding on this request again. See the timeline and the
            stock ledger for who voided them and why.
          </p>
        </div>
      )}

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
          {lines.map((line) => {
            const voided = Number(line.quantity_voided ?? 0)

            return (
              <div
                key={line.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {line.item?.name ?? "—"}
                  </p>
                  {/* Say why the number is not the one on the release card.
                      Without this the office sees a quantity quietly smaller
                      than the slip's and has no way to tell whether that is
                      the void or a mistake. */}
                  {voided > 0 && (
                    <p className="mt-0.5 text-xs text-amber-700">
                      {qty(line.quantity_issued)} issued, {qty(voided)} voided
                      by GSO
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-sm tabular-nums">
                  {qty(netIssued(line))}{" "}
                  <span className="text-xs text-muted-foreground">
                    {line.item?.unit?.code}
                  </span>
                </p>
              </div>
            )
          })}

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

/* ── Void ──────────────────────────────────────────────────────────────── */

/**
 * GSO taking back a line it recorded as issued — the item was on the slip and
 * on the receipt, but not on the shelf.
 *
 * Unlike a dispute, this **moves stock**: the quantity goes back to the
 * office's balance and becomes outstanding on the request again. That is the
 * whole reason it is GSO's action and not the receiving office's — the ledger
 * keeps exactly one author.
 *
 * Defaults to the entire outstanding quantity, because the common case is an
 * item that was not there at all. A partial void is for the trip that promised
 * fifty and handed over thirty.
 */
function VoidLineDialog({
  line,
  voidable,
  onDone,
  onError,
}: {
  line: RequestReleaseItemRow
  voidable: number
  onDone: () => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(voidable)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleVoid() {
    setSubmitting(true)
    const result = await voidReleaseItem({
      release_item_id: line.id,
      quantity,
      reason: reason.trim(),
    })
    setSubmitting(false)

    if (result.error) {
      onError(result.error)
      return
    }
    toast.success("Released line voided. The quantity is back on the balance.")
    setOpen(false)
    setReason("")
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            aria-label={`Void ${line.item?.name ?? "this line"}`}
          />
        }
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Void Released Line</DialogTitle>
          <DialogDescription>
            Use this when the goods were recorded as issued but never physically
            left the warehouse. The quantity goes back to the office&rsquo;s
            balance and becomes outstanding on this request again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border/60 px-3 py-2">
            <p className="text-sm font-medium">{line.item?.name ?? "—"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {qty(line.quantity_issued)} {line.item?.unit?.code} issued on this
              release
              {Number(line.quantity_voided ?? 0) > 0 && (
                <> · {qty(Number(line.quantity_voided))} already voided</>
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`void-qty-${line.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Quantity to void
            </Label>
            <Input
              id={`void-qty-${line.id}`}
              type="number"
              min={0}
              max={voidable}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="text-right tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              Up to {qty(voidable)} {line.item?.unit?.code}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`void-reason-${line.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Why is this being voided?
            </Label>
            <Textarea
              id={`void-reason-${line.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required — e.g. item was not in the warehouse and was never handed over"
              rows={3}
            />
            {/* The reason is the difference between this and a bare stock
                adjustment. It goes onto both the ledger row and the request's
                timeline, and it is what an auditor reads years from now. */}
            <p className="text-xs text-muted-foreground">
              Recorded on the stock ledger and on this request&rsquo;s timeline.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={
              submitting ||
              reason.trim().length < 5 ||
              quantity <= 0 ||
              quantity > voidable
            }
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Void Line
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
  // Pre-filled with what actually went out, so the office edits down from the
  // truth rather than from a figure that includes units GSO already took back.
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, netIssued(l)]))
  )
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const changed = lines.some(
    (l) => Number(received[l.id] ?? 0) !== netIssued(l)
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
            const voided = Number(line.quantity_voided ?? 0)
            const differs = value !== netIssued(line)

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
                    {qty(netIssued(line))} {line.item?.unit?.code} issued
                  </p>
                  {voided > 0 && (
                    <p className="text-xs text-amber-700">
                      {qty(line.quantity_issued)} on the slip, {qty(voided)}{" "}
                      voided by GSO
                    </p>
                  )}
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
