import type { Metadata } from "next"
import { CircleAlertIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireMember } from "@/lib/auth"

import { BreakdownCard } from "./_overview/breakdown"
import { loadOverview } from "./_overview/data"
import { GettingStarted } from "./_overview/getting-started"
import { HealthPanel } from "./_overview/health-panel"
import { KpiCards } from "./_overview/kpi-cards"
import { MemberWelcome } from "./_overview/member-welcome"
import { parseRange, RANGES } from "./_overview/range"
import {
  RangeBody,
  RangeProvider,
  RangeSwitcher,
} from "./_overview/range-switcher"
import { UsageCharts } from "./_overview/usage-charts"

export const metadata: Metadata = { title: "Overview" }

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const me = await requireMember()
  const range = parseRange((await searchParams).range)
  const data = await loadOverview(range)
  const config = RANGES[range]
  const showOnboarding = !data.hasAnyTraffic && data.errors.length === 0

  return (
    <RangeProvider range={range}>
      <PageTour id="overview" />
      <PageHeader
        title="Overview"
        description={
          showOnboarding
            ? me.isAdmin
              ? "Traffic, cost and health for every app using the gateway."
              : "Traffic and cost for your apps."
            : `${config.long}, compared with the ${config.previous}.`
        }
        actions={!showOnboarding && <RangeSwitcher />}
      />
      <RangeBody>
        {data.errors.length > 0 && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Some analytics failed to load</AlertTitle>
            <AlertDescription>{data.errors[0]}</AlertDescription>
          </Alert>
        )}

        {showOnboarding && !me.isAdmin ? (
          <MemberWelcome member={me} />
        ) : showOnboarding ? (
          <div className="grid gap-4 xl:grid-cols-3">
            <GettingStarted
              inventory={data.inventory}
              className="xl:col-span-2"
            />
            <HealthPanel cooling={data.cooling} inventory={data.inventory} />
          </div>
        ) : (
          <>
            <KpiCards
              current={data.current}
              previous={data.previous}
              period={config.previous}
            />
            <UsageCharts data={data.series} interval={data.window.interval} />
            {me.isAdmin ? (
              <div className="grid gap-4 xl:grid-cols-3">
                <BreakdownCard
                  byModel={data.byModel}
                  byProvider={data.byProvider}
                  byApp={data.byApp}
                  period={config.long.toLowerCase()}
                  className="xl:col-span-2"
                />
                <HealthPanel
                  cooling={data.cooling}
                  inventory={data.inventory}
                />
              </div>
            ) : (
              <BreakdownCard
                byModel={data.byModel}
                byApp={data.byApp}
                period={config.long.toLowerCase()}
              />
            )}
          </>
        )}
      </RangeBody>
    </RangeProvider>
  )
}
