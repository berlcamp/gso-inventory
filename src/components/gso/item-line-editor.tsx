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
import type { ItemWithRefs } from "@/types/database"

export interface EditorLine {
  item_id: string
  name: string
  unit: string
  category: string
  available: number
  quantity: number
}

type SearchHit = ItemWithRefs & { available: number }

/**
 * Item picker + quantity table shared by the new-request and walk-in forms.
 * `available` is the requesting office's remaining balance for the item —
 * releases draw it down, so it doubles as the ceiling for the line.
 */
export function ItemLineEditor({
  officeId,
  lines,
  onChange,
  enforceAvailable = false,
  disabled = false,
}: {
  officeId: string | null
  lines: EditorLine[]
  onChange: (lines: EditorLine[]) => void
  /** Walk-in releases deduct immediately, so quantities are capped there. */
  enforceAvailable?: boolean
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmed = query.trim()

  const canSearch = Boolean(officeId) && trimmed.length >= 2

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!canSearch) return

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const res = await searchItemsForOffice(officeId!, trimmed)
      setLoading(false)
      setSearched(true)
      if (!res.error) setResults(res.data)
    }, 250)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [canSearch, officeId, trimmed])

  // Stale hits are hidden rather than cleared, so the effect stays side-effect
  // free while the query is being retyped.
  const visibleResults = canSearch ? results : []

  function addItem(hit: SearchHit) {
    if (lines.some((l) => l.item_id === hit.id)) return
    onChange([
      ...lines,
      {
        item_id: hit.id,
        name: hit.name,
        unit: hit.unit?.code ?? "",
        category: hit.category?.name ?? "",
        available: hit.available,
        quantity: 1,
      },
    ])
    setQuery("")
    setResults([])
    setSearched(false)
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
                ? "Search item name — at least 2 characters…"
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

        {canSearch && searched && !loading && visibleResults.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No items matched &ldquo;{trimmed}&rdquo;.
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
                        {hit.available.toLocaleString()} remaining
                      </span>
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
                Remaining
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
                      Search above and add the supplies you need
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
                            : "Above remaining balance"}
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
