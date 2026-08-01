import { Skeleton } from "@/components/ui/skeleton"

/**
 * Stand-in for a `DataTable` while the page's rows are being fetched. Mirrors
 * the toolbar / table / pagination stack so nothing jumps when the real table
 * takes over.
 */
export function DataTableSkeleton({
  columns = 6,
  rows = 10,
  filters = 2,
}: {
  columns?: number
  rows?: number
  filters?: number
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-[250px]" />
          {Array.from({ length: filters }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="flex h-10 items-center gap-4 border-b border-border/60 bg-muted/40 px-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex h-12 items-center gap-4 border-b border-border/40 px-4"
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton
                key={colIndex}
                className="h-4 flex-1"
                style={{
                  opacity: Math.max(0.35, 1 - rowIndex * 0.07),
                  maxWidth: colIndex === 0 ? undefined : "70%",
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
    </div>
  )
}
