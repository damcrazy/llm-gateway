import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireMember } from "@/lib/auth"
import { DEFAULT_ALERT_SETTINGS } from "@/lib/gateway/alerts"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { AlertList, MarkAllReadButton } from "./alert-list"
import { AlertSettingsForm } from "./alert-settings-form"
import { ALERT_COLUMNS, toAlertItem } from "./shared"

export const metadata: Metadata = { title: "Alerts" }

export default async function AlertsPage() {
  const me = await requireMember()
  const db = supabaseAdmin()
  const [settingsResult, alertsResult, appsResult] = await Promise.all([
    db
      .from("alert_settings")
      .select(
        "budget_percent, notify_model_down, latency_threshold_ms, webhook_hint"
      )
      .eq("owner_email", me.email)
      .maybeSingle(),
    db
      .from("alerts")
      .select(ALERT_COLUMNS)
      .eq("owner_email", me.email)
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("apps").select("id, name").eq("owner_email", me.email),
  ])
  if (alertsResult.error) throw new Error(alertsResult.error.message)
  const settings = settingsResult.data
  const alerts = (alertsResult.data ?? []).map(toAlertItem)
  const appNames = Object.fromEntries(
    ((appsResult.data ?? []) as { id: string; name: string }[]).map((app) => [
      app.id,
      app.name,
    ])
  )

  return (
    <>
      <PageTour id="alerts" />
      <PageHeader
        title="Alerts"
        description="Find out when budgets run low, models start failing or responses slow down."
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <Card data-tour="alerts-list">
          <CardHeader>
            <CardTitle>Recent alerts</CardTitle>
            <CardDescription>Kept for 90 days.</CardDescription>
            <CardAction>
              <MarkAllReadButton
                disabled={!alerts.some((alert) => !alert.read)}
              />
            </CardAction>
          </CardHeader>
          <CardContent>
            <AlertList alerts={alerts} appNames={appNames} />
          </CardContent>
        </Card>
        <AlertSettingsForm
          initial={{
            budgetPercent:
              (settings?.budget_percent as number | undefined) ??
              DEFAULT_ALERT_SETTINGS.budgetPercent,
            notifyModelDown:
              (settings?.notify_model_down as boolean | undefined) ??
              DEFAULT_ALERT_SETTINGS.notifyModelDown,
            latencyThresholdMs:
              (settings?.latency_threshold_ms as number | null | undefined) ??
              null,
            webhookHint: (settings?.webhook_hint as string | null) ?? null,
          }}
        />
      </div>
    </>
  )
}
