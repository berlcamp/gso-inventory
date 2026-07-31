import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { getOfficesWithOfficers } from "@/lib/actions/catalog"
import { OfficesContent } from "./offices-content"

export const dynamic = "force-dynamic"

export default async function OfficesPage() {
  const result = await getOfficesWithOfficers()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offices"
        subtitle="Departments served by the General Services Office and their supply officers"
      />

      {result.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      <OfficesContent offices={result.data} />
    </div>
  )
}
