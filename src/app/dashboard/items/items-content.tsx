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
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
  Plus,
  Pencil,
  Tags,
  Loader2,
  AlertCircle,
  FolderPlus,
  Ruler,
} from "lucide-react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  createItem,
  updateItem,
  createCategory,
  createUnit,
} from "@/lib/actions/catalog"
import type { Category, ItemWithRefs, Unit } from "@/types/database"

function FieldGroup({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ItemsContent({
  rows,
  count,
  categories,
  units,
  page,
  pageSize,
}: {
  rows: ItemWithRefs[]
  count: number
  categories: Category[]
  units: Unit[]
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermissions()

  const category = searchParams.get("category") ?? ""
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "")

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/dashboard/items?${params.toString()}`)
  }

  const categoryOptions = [
    { label: "All categories", value: "__all" },
    ...categories.map((c) => ({ label: c.name, value: c.id })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          <SelectTrigger className="h-8 w-[240px]">
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

        <div className="flex flex-wrap items-center gap-2">
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

          {can("item.manage") && (
            <>
              <AddCategoryDialog onDone={() => router.refresh()} />
              <AddUnitDialog onDone={() => router.refresh()} />
              <ItemDialog
                categories={categories}
                units={units}
                onDone={() => router.refresh()}
              />
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Item
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                Category
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Unit
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                Reorder at
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </TableHead>
              {can("item.manage") && <TableHead className="w-[60px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Tags className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No items found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((item) => (
                <TableRow key={item.id} className="border-border/40 hover:bg-muted/30">
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    {item.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate text-xs text-muted-foreground lg:table-cell">
                    {item.category?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.unit?.code ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                    {Number(item.reorder_level).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {item.is_active ? (
                      <Badge variant="outline" className="border-green-200 text-green-700">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  {can("item.manage") && (
                    <TableCell>
                      <ItemDialog
                        item={item}
                        categories={categories}
                        units={units}
                        onDone={() => router.refresh()}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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

/* ── Item create / edit ────────────────────────────────────────────────── */

function ItemDialog({
  item,
  categories,
  units,
  onDone,
}: {
  item?: ItemWithRefs
  categories: Category[]
  units: Unit[]
  onDone: () => void
}) {
  const isEdit = Boolean(item)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(item?.name ?? "")
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "")
  const [unitId, setUnitId] = useState(item?.unit_id ?? "")
  const [description, setDescription] = useState(item?.description ?? "")
  const [reorderLevel, setReorderLevel] = useState(String(item?.reorder_level ?? 0))
  const [isActive, setIsActive] = useState(item?.is_active ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categoryOptions = categories.map((c) => ({ label: c.name, value: c.id }))
  const unitOptions = units.map((u) => ({
    label: `${u.code} — ${u.name}`,
    value: u.id,
  }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      name: name.trim(),
      category_id: categoryId,
      unit_id: unitId,
      description: description.trim() || null,
      reorder_level: Number(reorderLevel) || 0,
      is_active: isActive,
    }

    const result = isEdit
      ? await updateItem(item!.id, payload)
      : await createItem(payload)

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(isEdit ? "Item updated." : "Item added to the catalog.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="ghost" size="icon-xs" />
          ) : (
            <Button size="sm" />
          )
        }
      >
        {isEdit ? (
          <Pencil className="h-3.5 w-3.5" />
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            Add Item
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Item" : "Add Item"}</DialogTitle>
            <DialogDescription>
              An item is unique per name and unit of measure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FieldGroup label="Item name" htmlFor="item-name">
              <Input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PAPER Bond multicopy A4 Size"
              />
            </FieldGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldGroup label="Category">
                <Select
                  items={categoryOptions}
                  value={categoryId}
                  onValueChange={(value) => setCategoryId(value as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>

              <FieldGroup label="Unit">
                <Select
                  items={unitOptions}
                  value={unitId}
                  onValueChange={(value) => setUnitId(value as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
            </div>

            <FieldGroup
              label="Reorder level"
              htmlFor="reorder"
              hint="Balances at or below this level are flagged as low."
            >
              <Input
                id="reorder"
                type="number"
                min={0}
                step="any"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
              />
            </FieldGroup>

            <FieldGroup label="Description" htmlFor="item-desc">
              <Textarea
                id="item-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional specification"
              />
            </FieldGroup>

            <div className="flex items-center gap-2.5">
              <Checkbox
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked as boolean)}
              />
              <span className="text-sm">
                Active — available when building requests
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Category & unit quick-add ─────────────────────────────────────────── */

function AddCategoryDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await createCategory(name)
    setSubmitting(false)
    if (result.error) return setError(result.error)

    toast.success("Category added.")
    setName("")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <FolderPlus className="h-3.5 w-3.5" />
        Category
      </DialogTrigger>
      <DialogContent className="sm:max-w-[380px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Category</DialogTitle>
            <DialogDescription>
              Categories follow the PR sheet grouping and are stored uppercase.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OFFICE SUPPLIES"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddUnitDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await createUnit(code, name)
    setSubmitting(false)
    if (result.error) return setError(result.error)

    toast.success("Unit added.")
    setCode("")
    setName("")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Ruler className="h-3.5 w-3.5" />
        Unit
      </DialogTrigger>
      <DialogContent className="sm:max-w-[380px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Unit</DialogTitle>
            <DialogDescription>Unit of measure, e.g. REAM or BOX.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FieldGroup label="Code" htmlFor="unit-code">
              <Input
                id="unit-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="REAM"
              />
            </FieldGroup>
            <FieldGroup label="Name" htmlFor="unit-name">
              <Input
                id="unit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ream"
              />
            </FieldGroup>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
