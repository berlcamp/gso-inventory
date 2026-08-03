"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  Building2,
  Loader2,
  AlertCircle,
  UserPlus,
  Search,
} from "lucide-react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { createOffice, updateOffice } from "@/lib/actions/catalog"
import type { Office, OfficeStaff, OfficeWithStaff } from "@/types/database"

/** Name over email, as both staff columns render every person. */
function StaffList({ people }: { people: OfficeStaff[] }) {
  return (
    <div className="space-y-0.5">
      {people.slice(0, 2).map((person) => (
        <div key={person.id}>
          <p className="text-sm">{person.full_name}</p>
          <p className="text-xs text-muted-foreground">{person.email}</p>
        </div>
      ))}
      {people.length > 2 && (
        <p className="text-xs text-muted-foreground">+{people.length - 2} more</p>
      )}
    </div>
  )
}

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

export function OfficesContent({ offices }: { offices: OfficeWithStaff[] }) {
  const router = useRouter()
  const { can } = usePermissions()
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? offices.filter(
        (o) =>
          o.name.toLowerCase().includes(search.trim().toLowerCase()) ||
          o.code.toLowerCase().includes(search.trim().toLowerCase())
      )
    : offices

  const withoutOfficer = offices.filter(
    (o) => !o.is_gso && o.officers.length === 0
  ).length

  return (
    <div className="space-y-4">
      {withoutOfficer > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {withoutOfficer} office{withoutOfficer === 1 ? " has" : "s have"} no
            supply officer yet. Add them under{" "}
            <Link
              href="/dashboard/admin/users"
              className="font-medium text-primary hover:underline"
            >
              Admin → Users
            </Link>{" "}
            so they can file requests.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search office…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 pl-8"
          />
        </div>

        {can("office.manage") && <OfficeDialog onDone={() => router.refresh()} />}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Code
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Office
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Supply Officer
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                Head
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </TableHead>
              {can("office.manage") && <TableHead className="w-[60px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No offices found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((office) => (
                <TableRow key={office.id} className="border-border/40 hover:bg-muted/30">
                  <TableCell>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">
                      {office.code}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-sm font-medium">{office.name}</p>
                    {office.is_gso && (
                      <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                        CUSTODIAN
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {office.officers.length === 0 ? (
                      <Link
                        href="/dashboard/admin/users"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Not assigned
                      </Link>
                    ) : (
                      <StaffList people={office.officers} />
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {office.heads.length > 0 ? (
                      <StaffList people={office.heads} />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {office.head_name || "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {office.is_active ? (
                      <Badge variant="outline" className="border-green-200 text-green-700">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  {can("office.manage") && (
                    <TableCell>
                      <OfficeDialog office={office} onDone={() => router.refresh()} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function OfficeDialog({
  office,
  onDone,
}: {
  office?: Office
  onDone: () => void
}) {
  const isEdit = Boolean(office)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(office?.name ?? "")
  const [code, setCode] = useState(office?.code ?? "")
  const [contact, setContact] = useState(office?.contact_number ?? "")
  const [isActive, setIsActive] = useState(office?.is_active ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      name: name.trim(),
      code: code.trim(),
      contact_number: contact.trim() || null,
      is_active: isActive,
    }

    const result = isEdit
      ? await updateOffice(office!.id, payload)
      : await createOffice(payload)

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(isEdit ? "Office updated." : "Office added.")
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? <Button variant="ghost" size="icon-xs" /> : <Button size="sm" />
        }
      >
        {isEdit ? (
          <Pencil className="h-3.5 w-3.5" />
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            Add Office
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Office" : "Add Office"}</DialogTitle>
            <DialogDescription>
              The code is the short label shown throughout the system.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FieldGroup label="Office name" htmlFor="office-name">
              <Input
                id="office-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CITY BUDGET OFFICE"
              />
            </FieldGroup>

            <FieldGroup label="Code" htmlFor="office-code" hint="e.g. CBO">
              <Input
                id="office-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CBO"
              />
            </FieldGroup>

            <FieldGroup label="Contact number" htmlFor="office-contact">
              <Input
                id="office-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Optional"
              />
            </FieldGroup>

            <div className="flex items-center gap-2.5">
              <Checkbox
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked as boolean)}
              />
              <span className="text-sm">Active</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Office"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
