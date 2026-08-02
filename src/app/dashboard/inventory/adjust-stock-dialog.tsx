"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
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
import { Search, SlidersHorizontal, Loader2, AlertCircle } from "lucide-react"
import { adjustStock } from "@/lib/actions/inventory"
import type { Office } from "@/types/database"

const MOVEMENT_OPTIONS = [
  { label: "Replenishment — add stock", value: "replenishment" },
  { label: "Return — office returned stock", value: "return" },
  { label: "Adjustment — correction", value: "adjustment" },
]

export function AdjustStockDialog({
  offices,
  onDone,
}: {
  offices: Office[]
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [officeId, setOfficeId] = useState("")
  const [itemId, setItemId] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [movementType, setMovementType] = useState("replenishment")
  const [quantity, setQuantity] = useState("")
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const officeOptions = offices.map((o) => ({
    label: `${o.code} — ${o.name}`,
    value: o.id,
  }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsedQuantity = Number(quantity)
    if (!officeId) return setError("Select an office.")
    if (!itemId) return setError("Pick an item.")
    if (!parsedQuantity) return setError("Enter a non-zero quantity.")

    setSubmitting(true)
    const result = await adjustStock({
      office_id: officeId,
      item_id: itemId,
      movement_type: movementType,
      // A correction may go either way; the other two always add.
      quantity: movementType === "adjustment" ? parsedQuantity : Math.abs(parsedQuantity),
      remarks: remarks.trim() || null,
    })
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(
      `Balance updated — now ${result.data?.balance.toLocaleString()}.`
    )
    setOpen(false)
    setItemId("")
    setItemLabel("")
    setQuantity("")
    setRemarks("")
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Adjust Stock
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              Record a replenishment, a return, or a correction. Every
              adjustment writes a ledger entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Office
              </Label>
              <Select
                items={officeOptions}
                value={officeId}
                onValueChange={(value) => {
                  setOfficeId(value as string)
                  setItemId("")
                  setItemLabel("")
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
            </div>

            <ItemPicker
              officeId={officeId}
              selectedLabel={itemLabel}
              onSelect={(id, label) => {
                setItemId(id)
                setItemLabel(label)
              }}
            />

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Movement
              </Label>
              <Select
                items={MOVEMENT_OPTIONS}
                value={movementType}
                onValueChange={(value) => setMovementType(value as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="adjust-qty"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Quantity
              </Label>
              <Input
                id="adjust-qty"
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={
                  movementType === "adjustment"
                    ? "Use a negative number to deduct"
                    : "Quantity to add"
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="adjust-remarks"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Remarks
              </Label>
              <Textarea
                id="adjust-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. PO 2026-114 delivery received"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Minimal type-ahead used inside the adjust dialog. */
function ItemPicker({
  officeId,
  selectedLabel,
  onSelect,
}: {
  officeId: string
  selectedLabel: string
  onSelect: (id: string, label: string) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<
    { id: string; name: string; unit: string; available: number }[]
  >([])
  const [loading, setLoading] = useState(false)

  async function search(value: string) {
    setQuery(value)
    if (!officeId || value.trim().length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    // The whole catalog, not just what this office holds — an adjustment is
    // how an office starts carrying an item in the first place.
    const { searchCatalogForOffice } = await import("@/lib/actions/catalog")
    const res = await searchCatalogForOffice(officeId, value.trim())
    setLoading(false)
    if (!res.error) {
      setResults(
        res.data.map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit?.code ?? "",
          available: i.available,
        }))
      )
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Item
      </Label>
      {selectedLabel ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
          <span className="truncate text-sm">{selectedLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSelect("", "")
              setQuery("")
              setResults([])
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => search(e.target.value)}
              disabled={!officeId}
              placeholder={officeId ? "Search item…" : "Select an office first"}
              className="pl-9"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {results.length > 0 && (
            <ul className="max-h-48 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect(r.id, `${r.name} (${r.unit}) · ${r.available} remaining`)
                    }
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="block truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.unit} · {r.available.toLocaleString()} remaining
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
