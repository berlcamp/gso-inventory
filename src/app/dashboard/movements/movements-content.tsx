"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MovementBadge } from "@/components/shared/status-badge"
import { ChevronLeft, ChevronRight, ArrowLeftRight } from "lucide-react"
import { format } from "date-fns"
import type { Office, StockMovementRow } from "@/types/database"

const TYPE_OPTIONS = [
  { label: "All movements", value: "all" },
  { label: "Release", value: "release" },
  { label: "Replenishment", value: "replenishment" },
  { label: "Return", value: "return" },
  { label: "Adjustment", value: "adjustment" },
  { label: "Opening", value: "opening" },
]

export function MovementsContent({
  rows,
  count,
  offices,
  page,
  pageSize,
}: {
  rows: StockMovementRow[]
  count: number
  offices: Office[]
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const office = searchParams.get("office") ?? ""
  const type = searchParams.get("type") ?? "all"
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/dashboard/movements?${params.toString()}`)
  }

  const officeOptions = [
    { label: "All offices", value: "__all" },
    ...offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
  ]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Office
          </Label>
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
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Type
          </Label>
          <Select
            items={TYPE_OPTIONS}
            value={type}
            onValueChange={(value) =>
              updateParams({
                type: value === "all" ? "" : (value as string),
                page: "",
              })
            }
          >
            <SelectTrigger className="h-8 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="from"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            From
          </Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => updateParams({ from: e.target.value, page: "" })}
            className="h-8 w-[150px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="to"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            To
          </Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => updateParams({ to: e.target.value, page: "" })}
            className="h-8 w-[150px]"
          />
        </div>

        {(office || type !== "all" || from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              updateParams({ office: "", type: "", from: "", to: "", page: "" })
            }
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Date
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Item
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Office
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Qty
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                Balance
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                Reference
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <ArrowLeftRight className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No movements found</p>
                    <p className="text-xs text-muted-foreground">
                      Nothing matches the current filter
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const qty = Number(row.quantity)
                return (
                  <TableRow key={row.id} className="border-border/40 hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(row.created_at), "dd MMM yyyy")}
                      <span className="block text-[11px] text-muted-foreground">
                        {format(new Date(row.created_at), "h:mm a")}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate text-sm font-medium">
                        {row.item?.name ?? "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.item?.unit?.code ?? ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {row.office?.code}
                      </span>
                    </TableCell>
                    <TableCell>
                      <MovementBadge type={row.movement_type} />
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        qty < 0 ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {qty > 0 ? "+" : ""}
                      {qty.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                      {Number(row.balance_after).toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden max-w-[220px] lg:table-cell">
                      {row.request ? (
                        <Link
                          href={`/dashboard/requests/${row.request.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {row.request.request_no}
                        </Link>
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">
                          {row.remarks ?? "—"}
                        </span>
                      )}
                      {row.performer && (
                        <span className="block text-[11px] text-muted-foreground">
                          {row.performer.full_name}
                        </span>
                      )}
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
