"use client"

import { useState } from "react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/shared/status-badge"
import { Search, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import type { Office, SupplyRequestRow } from "@/types/database"

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "partially_released", label: "Partial" },
  { value: "released", label: "Released" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
]

export function RequestsTable({
  rows,
  count,
  offices,
  page,
  pageSize,
}: {
  rows: SupplyRequestRow[]
  count: number
  offices: Office[]
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const status = searchParams.get("status") ?? "all"
  const office = searchParams.get("office") ?? ""
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "")

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/dashboard/requests?${params.toString()}`)
  }

  const officeOptions = [
    { label: "All offices", value: "__all" },
    ...offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
  ]

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onValueChange={(value) =>
            updateParams({
              status: value === "all" ? "" : (value as string),
              page: "",
            })
          }
        >
          <TabsList variant="line">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          {offices.length > 1 && (
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
              <SelectTrigger className="h-8 w-[190px]">
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
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              updateParams({ search: searchInput, page: "" })
            }}
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search RIS # or purpose…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 w-56 h-8"
              />
            </div>
          </form>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/60">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                RIS #
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Office
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                Purpose
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                Requested by
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                Filed
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <ClipboardList className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No requests found</p>
                    <p className="text-xs text-muted-foreground">
                      Nothing matches the current filter
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((request) => (
                <TableRow
                  key={request.id}
                  className="hover:bg-muted/30 transition-colors border-border/40"
                >
                  <TableCell>
                    <Link
                      href={`/dashboard/requests/${request.id}`}
                      className="font-mono text-xs font-semibold text-primary hover:underline underline-offset-2"
                    >
                      {request.request_no}
                    </Link>
                    {request.source === "walk_in" && (
                      <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
                        WALK-IN
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {request.office?.code}
                    </span>
                    <span className="ml-2 hidden max-w-[200px] truncate align-middle text-sm xl:inline-block">
                      {request.office?.name}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate text-sm text-muted-foreground lg:table-cell">
                    {request.purpose || "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {request.requester?.full_name ?? request.requester_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    {formatDistanceToNow(new Date(request.requested_at), {
                      addSuffix: true,
                    })}
                  </TableCell>
                </TableRow>
              ))
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
            <span className="px-2 text-xs text-muted-foreground tabular-nums">
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
