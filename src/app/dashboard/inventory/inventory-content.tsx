"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Boxes,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { adjustStock } from "@/lib/actions/inventory"
import type { Category, Office, OfficeStockRow } from "@/types/database"

const MOVEMENT_OPTIONS = [
  { label: "Replenishment — add stock", value: "replenishment" },
  { label: "Return — office returned stock", value: "return" },
  { label: "Adjustment — correction", value: "adjustment" },
]

export function InventoryContent({
  rows,
  count,
  offices,
  categories,
  lowStockThreshold,
  page,
  pageSize,
}: {
  rows: OfficeStockRow[]
  count: number
  offices: Office[]
  categories: Category[]
  lowStockThreshold: number
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermissions()

  const office = searchParams.get("office") ?? ""
  const category = searchParams.get("category") ?? ""
  const low = searchParams.get("low") === "1"
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "")

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/dashboard/inventory?${params.toString()}`)
  }

  const officeOptions = [
    { label: "All offices", value: "__all" },
    ...offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
  ]
  const categoryOptions = [
    { label: "All categories", value: "__all" },
    ...categories.map((c) => ({ label: c.name, value: c.id })),
  ]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={officeOptions}
            value={office || "__all"}
            onValueChange={(value) =>
              updateParams({
                office: value === "__all" ? "" : (value as string),
                page: "",
              })
            }
          >
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="All offices" />
            </SelectTrigger>
            <SelectContent>
              {officeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={categoryOptions}
            value={category || "__all"}
            onValueChange={(value) =>
              updateParams({
                category: value === "__all" ? "" : (value as string),
                page: "",
              })
            }
          >
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            variant={low ? "default" : "outline"}
            onClick={() => updateParams({ low: low ? "" : "1", page: "" })}
          >
            Low stock only
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              updateParams({ search: searchInput, page: "" })
            }}
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search item…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 w-56 pl-8"
              />
            </div>
          </form>

          {can("inventory.adjust") && (
            <AdjustDialog offices={offices} onDone={() => router.refresh()} />
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Item
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden xl:table-cell">
                Category
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Office
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                Unit
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                Opening
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                Issued
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Remaining
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Boxes className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No stock records found</p>
                    <p className="text-xs text-muted-foreground">
                      Nothing matches the current filter
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const opening = Number(row.opening_quantity)
                const remaining = Number(row.quantity)
                const issued = opening - remaining
                const isLow = remaining > 0 && remaining <= lowStockThreshold
                const isOut = remaining <= 0

                return (
                  <TableRow key={row.id} className="border-border/40 hover:bg-muted/30">
                    <TableCell className="max-w-[280px]">
                      <p className="truncate text-sm font-medium">
                        {row.item?.name ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[200px] truncate text-xs text-muted-foreground xl:table-cell">
                      {row.item?.category?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {row.office?.code}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {row.item?.unit?.code ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                      {opening.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                      {issued.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        isOut
                          ? "text-red-700"
                          : isLow
                          ? "text-amber-700"
                          : "text-foreground"
                      }`}
                    >
                      {remaining.toLocaleString()}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)}
            </span>{" "}
            of <span className="font-medium text-foreground">{count}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Adjust dialog ─────────────────────────────────────────────────────── */

function AdjustDialog({
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
    const { searchItemsForOffice } = await import("@/lib/actions/catalog")
    const res = await searchItemsForOffice(officeId, value.trim())
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
