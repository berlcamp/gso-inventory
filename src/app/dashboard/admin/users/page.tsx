import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getUsers, getRoles } from "@/lib/actions/users"
import { getOffices } from "@/lib/actions/catalog"
import { UsersContent } from "./users-content"

export const dynamic = "force-dynamic"

export default async function UsersPage() {
  const [usersResult, rolesResult, officesResult] = await Promise.all([
    getUsers(),
    getRoles(),
    getOffices(true),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        subtitle="Who can sign in, which office they belong to, and what they may do"
      />

      {usersResult.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{usersResult.error}</AlertDescription>
        </Alert>
      )}

      <UsersContent
        users={usersResult.data}
        roles={rolesResult.data}
        offices={officesResult.data}
      />
    </div>
  )
}
