"use client"

import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Loader2, Boxes, ClipboardList, Building2, Layers, TrendingUp } from "lucide-react"
import { getStatusLabel } from "@/components/shared/status-badge"
import {
  getStockForExport,
  getMovementsForExport,
  getConsumptionForForecast,
  type CategoryIssuance,
  type MonthlyTrend,
  type OfficeIssuance,
} from "@/lib/actions/reports"
import { useFilterNav } from "@/lib/hooks/use-filter-nav"
import type { Office, RequestStatus } from "@/types/database"

/** Keys double as the search-param names — see `useFilterNav`. */
export type ReportFilterValues = {
  office: string
  from: string
  to: string
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const STATUS_ORDER: RequestStatus[] = [
  "awaiting_endorsement",
  "pending",
  "recommended",
  "approved",
  "partially_released",
  "released",
  "rejected",
  "cancelled",
]

function toCsv(headers: string[], rows: (string | number)[][]) {
  return [
    headers.join(","),
    ...rows.map((row) =>
      row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n")
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportsContent({
  byOffice,
  byCategory,
  trends,
  statusCounts,
  offices,
  filters,
  fiscalYear,
}: {
  byOffice: OfficeIssuance[]
  byCategory: CategoryIssuance[]
  trends: MonthlyTrend[]
  statusCounts: Record<RequestStatus, number>
  offices: Office[]
  filters: ReportFilterValues
  fiscalYear: number
}) {
  const [exporting, setExporting] = useState<
    "stock" | "movements" | "forecast" | null
  >(null)
  const { draft, isPending, apply, applyDebounced } = useFilterNav(
    "/dashboard/reports",
    filters
  )
  const { from, to, office } = draft

  const officeOptions = [
    { label: "All offices", value: "__all" },
    ...offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
  ]

  const totalIssued = byOffice.reduce((s, o) => s + o.units_issued, 0)
  const totalRemaining = byOffice.reduce((s, o) => s + o.remaining, 0)
  const totalRequests = Object.values(statusCounts).reduce((s, v) => s + v, 0)

  async function exportStock() {
    setExporting("stock")
    const result = await getStockForExport(office || undefined)
    setExporting(null)

    if (result.error || result.data.length === 0) {
      toast.error(result.error ?? "Nothing to export.")
      return
    }

    download(
      `gso-stock-balances-${fiscalYear}.csv`,
      toCsv(
        ["Office Code", "Office", "Category", "Item", "Unit", "Opening", "Issued", "Remaining"],
        result.data.map((r) => [
          r.office_code, r.office_name, r.category, r.item, r.unit,
          r.opening, r.issued, r.remaining,
        ])
      )
    )
  }

  async function exportMovements() {
    setExporting("movements")
    const result = await getMovementsForExport({
      from: from || undefined,
      to: to || undefined,
      officeId: office || undefined,
    })
    setExporting(null)

    if (result.error || result.data.length === 0) {
      toast.error(result.error ?? "Nothing to export.")
      return
    }

    download(
      `gso-stock-ledger-${fiscalYear}.csv`,
      toCsv(
        [
          "Date", "RIS #", "Office Code", "Office", "Category", "Item", "Unit",
          "Type", "Quantity", "Balance After", "Performed By", "Remarks",
        ],
        result.data.map((r) => [
          r.date, r.request_no, r.office_code, r.office_name, r.category,
          r.item, r.unit, r.type, r.quantity, r.balance_after,
          r.performed_by, r.remarks,
        ])
      )
    )
  }

  /**
   * Monthly consumption per item for an external forecasting pass.
   *
   * Ignores the filters above it by design — the whole ledger, every office.
   * Headers are snake_case rather than the Title Case the other two exports
   * use: this file is read by a machine, not opened in Excel.
   */
  async function exportForecast() {
    setExporting("forecast")
    const result = await getConsumptionForForecast()
    setExporting(null)

    if (result.error || result.data.length === 0) {
      toast.error(result.error ?? "No consumption history to export yet.")
      return
    }

    const { data_start, data_end, months_covered } = result.data[0]

    download(
      `gso-consumption-monthly-${data_start}-to-${data_end}.csv`,
      toCsv(
        [
          "item", "category", "unit", "year", "month", "is_partial_month",
          "units_issued", "units_returned", "requests",
          "opening_qty", "remaining_qty", "reorder_level",
          "data_start", "data_end", "months_covered",
        ],
        result.data.map((r) => [
          r.item, r.category, r.unit, r.year, r.month, r.is_partial_month,
          r.units_issued, r.units_returned, r.requests,
          r.opening_qty, r.remaining_qty, r.reorder_level,
          r.data_start, r.data_end, r.months_covered,
        ])
      )
    )

    toast.success(
      `${result.data.length.toLocaleString()} rows covering ${months_covered} month${
        months_covered === 1 ? "" : "s"
      } (${data_start} to ${data_end}).`
    )
  }

  return (
    <div className="space-y-6">
      {/* Filters + exports */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Office
            </Label>
            <Select
              items={officeOptions}
              value={office || "__all"}
              onValueChange={(value) =>
                apply({ office: value === "__all" ? "" : (value as string) })
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
            <Label
              htmlFor="report-from"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              From
            </Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => applyDebounced({ from: e.target.value })}
              className="h-8 w-[150px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="report-to"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              To
            </Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => applyDebounced({ to: e.target.value })}
              className="h-8 w-[150px]"
            />
          </div>

          {(from || to || office) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => apply({ from: "", to: "", office: "" })}
            >
              Clear
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportStock}
            disabled={exporting !== null}
            className="gap-1.5"
          >
            {exporting === "stock" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Balances CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportMovements}
            disabled={exporting !== null}
            className="gap-1.5"
          >
            {exporting === "movements" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Ledger CSV
          </Button>
          {/* Label says "all data" because this one ignores the filters sitting
              next to it — a truncated window is how this file goes wrong. */}
          <Button
            variant="outline"
            size="sm"
            onClick={exportForecast}
            disabled={exporting !== null}
            title="Monthly consumption per item for forecasting. Always covers every office and the whole ledger, ignoring the filters above."
            className="gap-1.5"
          >
            {exporting === "forecast" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" />
            )}
            Forecast CSV (all data)
          </Button>
        </div>
      </div>

      {/* Figures fade while a filter change is in flight, so it is obvious the
          numbers on screen are still the previous filter's. */}
      <div
        className={`space-y-6 transition-opacity ${
          isPending ? "pointer-events-none opacity-50" : ""
        }`}
      >
      {/* Highlight cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Units Issued",
            value: totalIssued.toLocaleString(),
            icon: Boxes,
            accent: "border-green-500",
            iconCls: "bg-green-50 text-green-600",
            valCls: "text-green-700",
          },
          {
            label: "Units Remaining",
            value: totalRemaining.toLocaleString(),
            icon: Layers,
            accent: "border-blue-500",
            iconCls: "bg-blue-50 text-blue-600",
            valCls: "text-blue-700",
          },
          {
            label: "Requests",
            value: totalRequests.toLocaleString(),
            icon: ClipboardList,
            accent: "border-amber-500",
            iconCls: "bg-amber-50 text-amber-600",
            valCls: "text-amber-700",
          },
          {
            label: "Offices Served",
            value: byOffice.filter((o) => o.units_issued > 0).length.toLocaleString(),
            icon: Building2,
            accent: "border-violet-500",
            iconCls: "bg-violet-50 text-violet-600",
            valCls: "text-violet-700",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`relative overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/8 border-l-4 ${s.accent}`}
          >
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
                    {s.label}
                  </p>
                  <p className={`truncate text-2xl font-bold tracking-tight ${s.valCls}`}>
                    {s.value}
                  </p>
                </div>
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.iconCls}`}
                >
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Issuance by office */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Issuance by Office
            </CardTitle>
            <CardDescription>
              Units released against what each office has left
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Office
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Issued
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Remaining
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOffice.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        No data for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    byOffice.map((row) => (
                      <TableRow key={row.office_id} className="border-border/40">
                        <TableCell className="text-sm">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {row.office_code}
                          </span>
                          <span className="ml-2 hidden max-w-[180px] truncate align-middle xl:inline-block">
                            {row.office_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-green-700">
                          {row.units_issued.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.remaining.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {byOffice.length > 0 && (
                    <TableRow className="border-t-2 border-border/60 bg-muted/20 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totalIssued.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totalRemaining.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Issuance by category */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Issuance by Category
            </CardTitle>
            <CardDescription>Where the supplies went</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Category
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Items
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Units
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byCategory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        No data for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    byCategory.map((row) => {
                      const max = byCategory[0].units_issued || 1
                      const pct = Math.round((row.units_issued / max) * 100)
                      return (
                        <TableRow key={row.category} className="border-border/40">
                          <TableCell className="max-w-[240px] text-sm">
                            <div className="flex items-center gap-2.5">
                              <div className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="truncate">{row.category}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.items}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {row.units_issued.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Requests by status */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Requests by Status
            </CardTitle>
            <CardDescription>
              {totalRequests.toLocaleString()} total in the selected period
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Count
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Share
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {STATUS_ORDER.map((status) => {
                  const count = statusCounts[status] ?? 0
                  const pct =
                    totalRequests > 0 ? Math.round((count / totalRequests) * 100) : 0
                  return (
                    <TableRow key={status} className="border-border/40">
                      <TableCell className="text-sm">{getStatusLabel(status)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {count}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                            {pct}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Monthly trend */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Monthly Issuance
            </CardTitle>
            <CardDescription>Units released per month — FY {fiscalYear}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Month
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Requests
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Units
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trends.map((row) => (
                  <TableRow key={row.month} className="border-border/40">
                    <TableCell className="text-sm font-medium">
                      {MONTHS[row.month - 1]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.requests}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.units_issued.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  )
}
