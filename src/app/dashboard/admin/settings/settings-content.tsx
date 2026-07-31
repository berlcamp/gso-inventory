"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Loader2, Save } from "lucide-react"
import { updateSystemSettings, type SystemSettings } from "@/lib/actions/settings"

export function SettingsContent({ settings }: { settings: SystemSettings }) {
  const router = useRouter()
  const [fiscalYear, setFiscalYear] = useState(String(settings.fiscal_year))
  const [lowStock, setLowStock] = useState(String(settings.low_stock_threshold))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const result = await updateSystemSettings({
      fiscal_year: Number(fiscalYear),
      low_stock_threshold: Number(lowStock),
    })

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }

    toast.success("Settings saved.")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Inventory</CardTitle>
          <CardDescription>
            Applies to every office in the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="fiscal-year"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Fiscal Year
            </Label>
            <Input
              id="fiscal-year"
              type="number"
              min={2000}
              max={2100}
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="max-w-[180px]"
            />
            <p className="text-xs text-muted-foreground">
              Opening balances and requests are tracked per fiscal year.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="low-stock"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Low Stock Threshold
            </Label>
            <Input
              id="low-stock"
              type="number"
              min={0}
              value={lowStock}
              onChange={(e) => setLowStock(e.target.value)}
              className="max-w-[180px]"
            />
            <p className="text-xs text-muted-foreground">
              Balances at or below this level are flagged on the dashboard and
              the inventory list.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>
    </form>
  )
}
