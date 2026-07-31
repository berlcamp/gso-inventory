import { PageHeader } from "@/components/layout/page-header"
import { getSystemSettings } from "@/lib/actions/settings"
import { SettingsContent } from "./settings-content"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const result = await getSystemSettings()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="System-wide defaults for the GSO Inventory System"
      />
      <SettingsContent settings={result.data} />
    </div>
  )
}
