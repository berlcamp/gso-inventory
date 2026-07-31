import { PageHeader } from "@/components/layout/page-header"
import { getOffices } from "@/lib/actions/catalog"
import { NewRequestForm } from "./new-request-form"

export const dynamic = "force-dynamic"

export default async function NewRequestPage() {
  const offices = await getOffices()

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Supply Request"
        subtitle="File a requisition with the General Services Office"
      />
      <NewRequestForm offices={offices.data} />
    </div>
  )
}
