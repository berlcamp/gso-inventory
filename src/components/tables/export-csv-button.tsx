"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface CsvColumn<TData> {
  header: string
  value: (row: TData) => string | number | null | undefined
}

function escapeCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Exports whatever the table is currently showing — the caller passes
 * `table.getFilteredRowModel()` rows, so the CSV matches the active filters
 * rather than the full dataset.
 */
export function ExportCsvButton<TData>({
  rows,
  filename,
  columns,
  label = "Export CSV",
}: {
  rows: TData[]
  filename: string
  columns: CsvColumn<TData>[]
  label?: string
}) {
  function handleExport() {
    const csv = [
      columns.map((c) => escapeCell(c.header)).join(","),
      ...rows.map((row) =>
        columns.map((c) => escapeCell(c.value(row))).join(",")
      ),
    ].join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={rows.length === 0}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </Button>
  )
}
