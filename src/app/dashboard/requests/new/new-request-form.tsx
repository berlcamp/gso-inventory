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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, ArrowLeft, Loader2, Send } from "lucide-react"
import { ItemLineEditor, type EditorLine } from "@/components/gso/item-line-editor"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useProfile } from "@/lib/hooks/use-profile"
import { createRequest } from "@/lib/actions/requests"
import type { Office } from "@/types/database"

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

export function NewRequestForm({ offices }: { offices: Office[] }) {
  const router = useRouter()
  const { profile, isLoading: profileLoading } = useProfile()
  const { can, loading: permsLoading } = usePermissions()

  // Defaults to the signed-in user's own office until GSO staff pick another.
  const [officeOverride, setOfficeOverride] = useState<string | null>(null)
  const officeId = officeOverride ?? profile?.office_id ?? ""

  const [purpose, setPurpose] = useState("")
  const [remarks, setRemarks] = useState("")
  const [lines, setLines] = useState<EditorLine[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A supply officer files only for their own office; GSO staff choose.
  const canChooseOffice = can("request.view_all")

  const officeOptions = offices.map((o) => ({
    label: `${o.code} — ${o.name}`,
    value: o.id,
  }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!officeId) {
      setError("Select the requesting office.")
      return
    }
    if (lines.length === 0) {
      setError("Add at least one item to the request.")
      return
    }
    if (lines.some((l) => !l.quantity || l.quantity <= 0)) {
      setError("Every item needs a quantity greater than zero.")
      return
    }

    setSubmitting(true)
    const result = await createRequest({
      office_id: officeId,
      purpose: purpose.trim(),
      remarks: remarks.trim() || null,
      lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
    })

    if (result.error || !result.data) {
      setError(result.error ?? "Could not file the request.")
      setSubmitting(false)
      return
    }

    toast.success("Request filed. GSO will review it shortly.")
    router.push(`/dashboard/requests/${result.data.id}`)
  }

  if (profileLoading || permsLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (!can("request.create")) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          You do not have permission to file supply requests. Ask the GSO
          administrator to assign you the Supply Officer role.
        </AlertDescription>
      </Alert>
    )
  }

  const selectedOffice = offices.find((o) => o.id === officeId)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request Details</CardTitle>
          <CardDescription>
            Requests are reviewed by GSO before any stock is released.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldGroup label="Requesting Office">
            {canChooseOffice ? (
              <Select
                items={officeOptions}
                value={officeId}
                onValueChange={(value) => {
                  setOfficeOverride(value as string)
                  setLines([])
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an office" />
                </SelectTrigger>
                <SelectContent>
                  {officeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
                {selectedOffice
                  ? `${selectedOffice.code} — ${selectedOffice.name}`
                  : "No office assigned to your account"}
              </div>
            )}
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
            &ldquo;Remaining&rdquo; is your office&apos;s balance for the fiscal
            year. Releases draw it down.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemLineEditor
            officeId={officeId || null}
            lines={lines}
            onChange={setLines}
            disabled={submitting}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard/requests" />}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to requests
        </Button>

        <Button type="submit" disabled={submitting || lines.length === 0}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Submit Request
        </Button>
      </div>
    </form>
  )
}
