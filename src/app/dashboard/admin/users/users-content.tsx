"use client"

import { useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
  AlertCircle,
  Loader2,
  Users,
  Power,
  Search,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { addUser, updateUser, setUserActive } from "@/lib/actions/users"
import type { Office, Role, UserProfileRow } from "@/types/database"

const NO_OFFICE = "__none"

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

export function UsersContent({
  users,
  roles,
  offices,
}: {
  users: UserProfileRow[]
  roles: Role[]
  offices: Office[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? users.filter((u) => {
        const term = search.trim().toLowerCase()
        return (
          u.full_name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          (u.office?.code ?? "").toLowerCase().includes(term)
        )
      })
    : users

  async function toggleActive(user: UserProfileRow) {
    const next = !user.is_active
    if (
      !confirm(
        next
          ? `Reactivate ${user.full_name}?`
          : `Deactivate ${user.full_name}? They will no longer be able to sign in.`
      )
    )
      return

    const result = await setUserActive(user.id, next)
    if (result.error) {
      setError(result.error)
      return
    }
    toast.success(next ? "User reactivated." : "User deactivated.")
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, or office…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-72 pl-8"
          />
        </div>

        <UserDialog roles={roles} offices={offices} onDone={() => router.refresh()} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Name
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Office
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Roles
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                Added
              </TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">No users yet</p>
                    <p className="text-xs text-muted-foreground">
                      Add a supply officer to get started
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow
                  key={user.id}
                  className={`border-border/40 transition-colors hover:bg-muted/30 ${
                    user.is_active ? "" : "opacity-60"
                  }`}
                >
                  <TableCell>
                    <p className="text-sm font-semibold text-foreground">
                      {user.full_name}
                      {!user.is_active && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {user.email}
                      {user.position ? ` · ${user.position}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    {user.office ? (
                      <>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {user.office.code}
                        </span>
                        <span className="ml-2 hidden max-w-[180px] truncate align-middle text-sm xl:inline-block">
                          {user.office.name}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No office
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.user_roles?.map((ur) => (
                        <Badge
                          key={ur.id}
                          variant="outline"
                          className="border-primary/20 text-xs text-primary"
                        >
                          {ur.role?.name ?? ur.role_id}
                        </Badge>
                      ))}
                      {(!user.user_roles || user.user_roles.length === 0) && (
                        <span className="text-xs text-muted-foreground">
                          No roles
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {formatDistanceToNow(new Date(user.created_at), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <UserDialog
                        user={user}
                        roles={roles}
                        offices={offices}
                        onDone={() => router.refresh()}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => toggleActive(user)}
                        title={user.is_active ? "Deactivate" : "Reactivate"}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Only users listed here can sign in. Add someone by their Google email and
        assign the office they file requests for — they get access the first time
        they sign in with that account.
      </p>
    </div>
  )
}

function UserDialog({
  user,
  roles,
  offices,
  onDone,
}: {
  user?: UserProfileRow
  roles: Role[]
  offices: Office[]
  onDone: () => void
}) {
  const isEdit = Boolean(user)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(user?.email ?? "")
  const [fullName, setFullName] = useState(user?.full_name ?? "")
  const [position, setPosition] = useState(user?.position ?? "")
  const [officeId, setOfficeId] = useState(user?.office_id ?? "")
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user?.user_roles?.map((ur) => ur.role_id) ?? []
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const officeOptions = [
    { label: "No office", value: NO_OFFICE },
    ...offices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id })),
  ]

  function toggleRole(roleId: string, checked: boolean) {
    setSelectedRoles((prev) =>
      checked ? [...prev, roleId] : prev.filter((r) => r !== roleId)
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const base = {
      full_name: fullName.trim(),
      position: position.trim() || null,
      office_id: officeId && officeId !== NO_OFFICE ? officeId : null,
      role_ids: selectedRoles,
    }

    const result = isEdit
      ? await updateUser(user!.id, base)
      : await addUser({ ...base, email: email.trim().toLowerCase() })

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(isEdit ? "User updated." : "User added.")
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
            Add User
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit User" : "Add User"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? user?.email
                : "Add by Google email. They can sign in once added."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!isEdit && (
              <FieldGroup label="Google Email" htmlFor="user-email">
                <Input
                  id="user-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="supply.officer@gmail.com"
                />
              </FieldGroup>
            )}

            <FieldGroup label="Full Name" htmlFor="user-name">
              <Input
                id="user-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Juan Dela Cruz"
              />
            </FieldGroup>

            <FieldGroup label="Position" htmlFor="user-position">
              <Input
                id="user-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Supply Officer"
              />
            </FieldGroup>

            <FieldGroup
              label="Office"
              hint="Supply officers can only file requests for their own office."
            >
              <Select
                items={officeOptions}
                value={officeId || NO_OFFICE}
                onValueChange={(value) => setOfficeId(value as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an office" />
                </SelectTrigger>
                <SelectContent>
                  {officeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>

            <FieldGroup label="Roles">
              <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                {roles.map((role) => (
                  <div key={role.id} className="flex items-start gap-2.5">
                    <Checkbox
                      checked={selectedRoles.includes(role.id)}
                      onCheckedChange={(checked) =>
                        toggleRole(role.id, checked as boolean)
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {role.name}
                      </p>
                      {role.description && (
                        <p className="text-xs text-muted-foreground">
                          {role.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Add User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
