"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, ArrowLeft, Loader2, Save } from "lucide-react"
import {
  ItemLineEditor,
  type EditorLine,
} from "@/components/gso/item-line-editor"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { updateRequest } from "@/lib/actions/requests"
import type { ItemAvailability, SupplyRequestRow } from "@/types/database"

function FieldGroup({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * The same form as filing, opened on an existing slip: purpose, remarks, and
 * the item list with lines free to be added and removed.
 *
 * Both desks on the office's own side of the request get here — the supply
 * officer who filed it and the head who is about to endorse it — and the
 * window closes the moment it is endorsed. `updateRequest` enforces all three
 * of those; the guards below only explain them before someone types.
 *
 * The office is fixed. Every allocation check and the set of heads who can
 * endorse hang off it, so there is no picker: moving a slip to another office
 * is filing a different request.
 */
export function EditRequestForm({
  request,
  availability,
}: {
  request: SupplyRequestRow
  availability: Record<string, ItemAvailability>
}) {
  const router = useRouter()
  const { can } = usePermissions()

  const [purpose, setPurpose] = useState(request.purpose ?? "")
  const [remarks, setRemarks] = useState(request.remarks ?? "")
  // Seeded from the request's own lines. `availability` is this office's
  // balance less what *other* approved requests have claimed, so the ceiling
  // on screen is the one the action will check at submit.
  const [lines, setLines] = useState<EditorLine[]>(() =>
    (request.request_items ?? []).map((line) => {
      const stock = availability[line.item_id]
      const balance = stock?.balance ?? 0
      const committed = stock?.committed ?? 0
      return {
        item_id: line.item_id,
        name: line.item?.name ?? "Unknown item",
        unit: line.item?.unit?.code ?? "",
        category: line.item?.category?.name ?? "",
        available: stock?.available ?? balance - committed,
        balance,
        committed,
        quantity: Number(line.quantity_requested),
      }
    })
  )
  const [submitting, setSubmitting] = useState(false)

  const canEdit = can("request.create") || can("request.endorse")

  if (request.status !== "awaiting_endorsement") {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="space-y-3">
          <p>
            This request has already been endorsed, so it can no longer be
            edited — GSO works from the quantities the head signed off on. File
            a new request if something needs to change.
          </p>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/dashboard/requests/${request.id}`} />}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to the request
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!canEdit) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          You do not have permission to edit supply requests. Only the office&apos;s
          supply officer or its department head can change a slip before it is
          endorsed.
        </AlertDescription>
      </Alert>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (lines.length === 0) {
      toast.error("A request needs at least one item.")
      return
    }
    if (lines.some((l) => !l.quantity || l.quantity <= 0)) {
      toast.error("Every item needs a quantity greater than zero.")
      return
    }

    setSubmitting(true)
    const result = await updateRequest(request.id, {
      purpose: purpose.trim(),
      remarks: remarks.trim() || null,
      lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
    })

    if (result.error) {
      toast.error(result.error)
      setSubmitting(false)
      return
    }

    toast.success("Request updated.")
    router.push(`/dashboard/requests/${request.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request Details</CardTitle>
          <CardDescription>
            Changes are recorded on the request&apos;s timeline. This slip keeps
            its RIS number and its place in the queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldGroup label="Requesting Office">
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
              {request.office
                ? `${request.office.code} — ${request.office.name}`
                : "—"}
            </div>
          </FieldGroup>

          <FieldGroup
            label="Purpose"
            htmlFor="purpose"
            hint="What the supplies will be used for — appears on the RIS."
          >
            <Textarea
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Office operations for the month of August"
              rows={2}
            />
          </FieldGroup>

          <FieldGroup label="Remarks" htmlFor="remarks">
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes for GSO"
              rows={2}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Items</CardTitle>
          <CardDescription>
            Add or remove items and adjust any quantity. &ldquo;Available&rdquo;
            is this office&apos;s remaining balance less whatever earlier
            approved requests are still waiting to collect — this request&apos;s
            own quantities are not counted against it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemLineEditor
            officeId={request.office_id}
            lines={lines}
            onChange={setLines}
            disabled={submitting}
            twoColumn
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/dashboard/requests/${request.id}`} />}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to the request
        </Button>

        <Button type="submit" disabled={submitting || lines.length === 0}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>
    </form>
  )
}
