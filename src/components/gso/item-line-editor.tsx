"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, Plus, Search, Trash2, PackageSearch } from "lucide-react"
import { searchItemsForOffice } from "@/lib/actions/catalog"
import type { ItemPickerMode, OfficeItemHit } from "@/types/database"

export interface EditorLine {
  item_id: string
  name: string
  unit: string
  category: string
  /** The mode-appropriate ceiling for this line — see `searchItemsForOffice`. */
  available: number
  balance: number
  committed: number
  quantity: number
}

/**
 * Item picker + quantity table shared by the new-request and walk-in forms.
 *
 * The list only ever contains items the office can actually draw right now:
 * the action reads its `office_stocks` allocation and drops anything with
 * nothing left. `available` is that item's ceiling — `balance - committed` for
 * a request, the raw balance for a walk-in, matching the check each flow hits.
 */
export function ItemLineEditor({
  officeId,
  lines,
  onChange,
  mode = "request",
  disabled = false,
}: {
  officeId: string | null
  lines: EditorLine[]
  onChange: (lines: EditorLine[]) => void
  mode?: ItemPickerMode
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  // Tagged with the office it was fetched for, so switching offices can never
  // leave the previous office's shelf on screen while the next one loads.
  const [results, setResults] = useState<{
    officeId: string
    hits: OfficeItemHit[]
    error: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmed = query.trim()

  // Walk-in releases deduct immediately, so the quantity input is hard-capped.
  const enforceAvailable = mode === "walk_in"

  // An empty query lists everything the office holds: with the catalog already
  // narrowed to its own allocation the whole shelf is worth showing, and a
  // blank box would otherwise hide how little (or how much) is there.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!officeId) return

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const res = await searchItemsForOffice(officeId, trimmed, mode)
      setLoading(false)
      setResults({ officeId, hits: res.data, error: res.error })
    }, 250)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [officeId, trimmed, mode])

  const current = results?.officeId === officeId ? results : null
  const visibleResults = current?.hits ?? []

  function addItem(hit: OfficeItemHit) {
    if (lines.some((l) => l.item_id === hit.id)) return
    onChange([
      ...lines,
      {
        item_id: hit.id,
        name: hit.name,
        unit: hit.unit?.code ?? "",
        category: hit.category?.name ?? "",
        available: hit.available,
        balance: hit.balance,
        committed: hit.committed,
        quantity: 1,
      },
    ])
    setQuery("")
  }

  function updateQuantity(itemId: string, quantity: number) {
    onChange(
      lines.map((l) => (l.item_id === itemId ? { ...l, quantity } : l))
    )
  }

  function removeLine(itemId: string) {
    onChange(lines.filter((l) => l.item_id !== itemId))
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              officeId
                ? "Search the items available to this office…"
                : "Select an office first"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!officeId || disabled}
            className="pl-9"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {current && !loading && visibleResults.length === 0 && (
          <p
            className={`text-sm ${
              current.error ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {current.error
              ? current.error
              : trimmed
                ? `No item matching “${trimmed}” has stock available to this office.`
                : "This office has no items with stock available for the fiscal year."}
          </p>
        )}

        {visibleResults.length > 0 && (
          <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60">
            {visibleResults.map((hit) => {
              const alreadyAdded = lines.some((l) => l.item_id === hit.id)
              return (
                <li
                  key={hit.id}
                  className="flex items-center justify-between gap-3 p-2.5 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{hit.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {hit.category?.name ?? "—"} · {hit.unit?.code ?? "—"} ·{" "}
                      <span
                        className={
                          hit.available > 0
                            ? "font-medium text-foreground"
                            : "font-medium text-red-600"
                        }
                      >
                        {hit.available.toLocaleString()} available
                      </span>
                      {!enforceAvailable && hit.committed > 0 && (
                        <>
                          {" "}
                          · {hit.balance.toLocaleString()} remaining,{" "}
                          {hit.committed.toLocaleString()} awaiting release
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={alreadyAdded || disabled}
                    onClick={() => addItem(hit)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {alreadyAdded ? "Added" : "Add"}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Selected lines */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Item
              </TableHead>
              <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                Unit
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Available
              </TableHead>
              <TableHead className="w-[130px] text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quantity
              </TableHead>
              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <PackageSearch className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No items added yet</p>
                    <p className="text-xs text-muted-foreground">
                      Pick from the items available to this office above
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line) => {
                const over = line.quantity > line.available
                return (
                  <TableRow key={line.item_id} className="border-border/40">
                    <TableCell>
                      <p className="text-sm font-medium">{line.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {line.category}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {line.unit}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {line.available.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        max={enforceAvailable ? line.available : undefined}
                        value={line.quantity}
                        disabled={disabled}
                        onChange={(e) =>
                          updateQuantity(line.item_id, Number(e.target.value))
                        }
                        className={`h-8 text-right tabular-nums ${
                          over ? "border-destructive focus-visible:border-destructive" : ""
                        }`}
                      />
                      {over && (
                        <p className="mt-1 text-[11px] text-destructive">
                          {enforceAvailable
                            ? "Exceeds remaining balance"
                            : "Above what is available"}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={disabled}
                        onClick={() => removeLine(line.item_id)}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Remove item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {lines.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {lines.length} item{lines.length === 1 ? "" : "s"} ·{" "}
          {lines
            .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
            .toLocaleString()}{" "}
          total units
        </p>
      )}
    </div>
  )
}
