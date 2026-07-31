import { PageHeader } from "@/components/layout/page-header"
import { getOffices } from "@/lib/actions/catalog"
import { WalkInForm } from "./walk-in-form"

export const dynamic = "force-dynamic"

export default async function WalkInPage() {
  const offices = await getOffices()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Walk-in Release"
        subtitle="Record supplies handed over the counter without a filed request"
      />
      <WalkInForm offices={offices.data} />
    </div>
  )
}
