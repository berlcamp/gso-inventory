import { PageHeader } from "@/components/layout/page-header"
import { AccountContent } from "./account-content"

export const dynamic = "force-dynamic"

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Account"
        subtitle="Your profile, office assignment, and permissions"
      />
      <AccountContent />
    </div>
  )
}
