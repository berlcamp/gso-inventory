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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { AlertCircle, Loader2, PackageCheck } from "lucide-react"
import { ItemLineEditor, type EditorLine } from "@/components/gso/item-line-editor"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { createWalkInRelease } from "@/lib/actions/requests"
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

export function WalkInForm({ offices }: { offices: Office[] }) {
  const router = useRouter()
  const { can, loading } = usePermissions()

  const [officeId, setOfficeId] = useState("")
  const [requesterName, setRequesterName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [remarks, setRemarks] = useState("")
  const [lines, setLines] = useState<EditorLine[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const officeOptions = offices.map((o) => ({
    label: `${o.code} — ${o.name}`,
    value: o.id,
  }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!officeId) return setError("Select the office collecting the supplies.")
    if (!requesterName.trim())
      return setError("Enter the name of the person collecting.")
    if (lines.length === 0) return setError("Add at least one item.")
    if (lines.some((l) => !l.quantity || l.quantity <= 0))
      return setError("Every item needs a quantity greater than zero.")

    const overdrawn = lines.find((l) => l.quantity > l.available)
    if (overdrawn) {
      return setError(
        `"${overdrawn.name}" only has ${overdrawn.available.toLocaleString()} remaining for this office.`
      )
    }

    setSubmitting(true)
    const result = await createWalkInRelease({
      office_id: officeId,
      requester_name: requesterName.trim(),
      purpose: purpose.trim() || null,
      remarks: remarks.trim() || null,
      lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
    })

    if (result.error || !result.data) {
      setError(result.error ?? "Could not record the release.")
      setSubmitting(false)
      return
    }

    toast.success("Walk-in release recorded. Balances updated.")
    router.push(`/dashboard/requests/${result.data.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (!can("request.walk_in")) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Only GSO custodians can record walk-in releases.
        </AlertDescription>
      </Alert>
    )
  }

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
          <CardTitle className="text-lg">Counter Transaction</CardTitle>
          <CardDescription>
            This releases stock immediately — no approval step. The office
            balance is deducted the moment you save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Office">
              <Select
                items={officeOptions}
                value={officeId}
                onValueChange={(value) => {
                  setOfficeId(value as string)
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
            </FieldGroup>

            <FieldGroup
              label="Received by"
              htmlFor="requester"
              hint="Name of the person collecting the supplies."
            >
              <Input
                id="requester"
                value={requesterName}
                onChange={(e) => setRequesterName(e.target.value)}
                placeholder="Juan Dela Cruz"
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Purpose" htmlFor="walkin-purpose">
            <Textarea
              id="walkin-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Optional — what the supplies are for"
              rows={2}
            />
          </FieldGroup>

          <FieldGroup label="Remarks" htmlFor="walkin-remarks">
            <Textarea
              id="walkin-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note recorded on each ledger entry"
              rows={2}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Items Released</CardTitle>
          <CardDescription>
            Quantities cannot exceed the office&apos;s remaining balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemLineEditor
            officeId={officeId || null}
            lines={lines}
            onChange={setLines}
            enforceAvailable
            disabled={submitting}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || lines.length === 0}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PackageCheck className="h-4 w-4" />
          )}
          Record Release
        </Button>
      </div>
    </form>
  )
}
