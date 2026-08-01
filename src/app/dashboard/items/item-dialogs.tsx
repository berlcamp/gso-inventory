"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
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
  Plus,
  Pencil,
  Loader2,
  AlertCircle,
  FolderPlus,
  Ruler,
} from "lucide-react"
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

/* ── Item create / edit ────────────────────────────────────────────────── */

export function ItemDialog({
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

export function AddCategoryDialog({ onDone }: { onDone: () => void }) {
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

export function AddUnitDialog({ onDone }: { onDone: () => void }) {
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
