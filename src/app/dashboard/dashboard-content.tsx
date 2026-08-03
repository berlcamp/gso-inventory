"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/shared/status-badge"
import { TimelineLog } from "@/components/shared/timeline-log"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  ClipboardList,
  PackageCheck,
  Boxes,
  Stamp,
  TrendingDown,
  ArrowRight,
  AlertCircle,
} from "lucide-react"
import type {
  DashboardStats,
  PipelineItem,
  TopItem,
  LowStockEntry,
} from "@/lib/actions/dashboard"
import type { RequestLogRow } from "@/types/database"

const statCards = [
  {
    key: "awaitingEndorsement" as const,
    title: "For Endorsement",
    icon: Stamp,
    description: "Waiting on the department head",
    href: "/dashboard/requests?status=awaiting_endorsement",
    accent: "border-purple-500",
    iconBg: "bg-purple-50 text-purple-600",
    valueCls: "text-purple-700",
  },
  {
    key: "pendingRequests" as const,
    title: "For GSO Review",
    icon: ClipboardList,
    description: "Endorsed, awaiting GSO",
    href: "/dashboard/requests?status=pending",
    accent: "border-amber-500",
    iconBg: "bg-amber-50 text-amber-600",
    valueCls: "text-amber-700",
  },
  {
    key: "awaitingRelease" as const,
    title: "Awaiting Release",
    icon: PackageCheck,
    description: "Approved, not yet issued",
    href: "/dashboard/requests?status=approved",
    accent: "border-blue-500",
    iconBg: "bg-blue-50 text-blue-600",
    valueCls: "text-blue-700",
  },
  {
    key: "unitsIssuedThisMonth" as const,
    title: "Units Issued",
    icon: Boxes,
    description: "This month",
    href: "/dashboard/movements",
    accent: "border-green-500",
    iconBg: "bg-green-50 text-green-600",
    valueCls: "text-green-700",
  },
  {
    key: "lowStockItems" as const,
    title: "Low Stock",
    icon: TrendingDown,
    description: "At or below the threshold",
    href: "/dashboard/inventory?low=1",
    accent: "border-red-500",
    iconBg: "bg-red-50 text-red-600",
    valueCls: "text-red-700",
  },
]

export function DashboardContent({
  stats,
  error,
  pipeline,
  activity,
  topItems,
  lowStock,
}: {
  stats: DashboardStats | null
  error: string | null
  pipeline: PipelineItem[]
  activity: RequestLogRow[]
  topItems: TopItem[]
  lowStock: LowStockEntry[]
}) {
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((stat) => (
          <Link
            key={stat.key}
            href={stat.href}
            className={`relative overflow-hidden rounded-xl bg-card ring-1 ring-foreground/8 shadow-sm border-l-4 transition-all hover:ring-foreground/15 ${stat.accent}`}
          >
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                    {stat.title}
                  </p>
                  <p
                    className={`text-3xl font-bold tracking-tight ${stat.valueCls}`}
                  >
                    {stats ? stats[stat.key].toLocaleString() : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </div>
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${stat.iconBg}`}
                >
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Pipeline */}
      {pipeline.length > 0 && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Request Pipeline
              {stats && (
                <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">
                  · {stats.scopeLabel}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {pipeline.map((item, index) => (
                <div key={item.status} className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/requests?status=${item.status}`}
                    className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3.5 py-2 hover:bg-muted hover:border-border transition-all"
                  >
                    <StatusBadge status={item.status} />
                    <span className="text-base font-bold text-foreground tabular-nums">
                      {item.count}
                    </span>
                  </Link>
                  {index < pipeline.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Most issued */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Most Issued — Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {topItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No releases recorded in the last 30 days.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Issued
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topItems.map((item) => {
                    const max = topItems[0].quantity || 1
                    const pct = Math.round((item.quantity / max) * 100)
                    return (
                      <TableRow key={item.item_id} className="border-border/40">
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2.5">
                            <div className="hidden sm:block h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="truncate">{item.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                          {item.quantity.toLocaleString()}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {item.unit}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Low stock */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Running Low
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {lowStock.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing is running low right now.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                      Office
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Left
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((row) => (
                    <TableRow
                      key={`${row.office_id}-${row.item_id}`}
                      className="border-border/40"
                    >
                      <TableCell className="max-w-[220px] truncate text-sm">
                        {row.item_name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {row.office_code}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-red-700 whitespace-nowrap">
                        {row.quantity.toLocaleString()}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          {row.unit}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <TimelineLog entries={activity} />
        </CardContent>
      </Card>
    </>
  )
}
