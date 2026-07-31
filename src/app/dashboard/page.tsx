import { PageHeader } from "@/components/layout/page-header"
import {
  getDashboardStats,
  getPipelineCounts,
  getRecentActivity,
  getTopIssuedItems,
  getLowStock,
} from "@/lib/actions/dashboard"
import { DashboardContent } from "./dashboard-content"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const [stats, pipeline, activity, topItems, lowStock] = await Promise.all([
    getDashboardStats(),
    getPipelineCounts(),
    getRecentActivity(8),
    getTopIssuedItems(8),
    getLowStock(8),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Office supplies inventory and issuance — General Services Office"
      />

      <DashboardContent
        stats={stats.data}
        error={stats.error}
        pipeline={pipeline.data}
        activity={activity.data}
        topItems={topItems.data}
        lowStock={lowStock.data}
      />
    </div>
  )
}
