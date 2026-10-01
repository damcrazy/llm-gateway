"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCwIcon, XIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import {
  DASHBOARD_APP,
  DEFAULT_FILTERS,
  filtersToQuery,
  RANGES,
  type LogFilters,
  type RangeValue,
  type StatusFilter,
} from "./_lib"

const ALL = "__all"

export function LogFiltersBar({
  filters,
  apps,
  models,
}: {
  filters: LogFilters
  apps: { slug: string; name: string }[]
  models: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const isDefault =
    filters.status === DEFAULT_FILTERS.status &&
    !filters.app &&
    !filters.model &&
    filters.range === DEFAULT_FILTERS.range

  function update(patch: Partial<LogFilters>) {
    const next = { ...filters, ...patch, page: 1 }
    startTransition(() => router.push(`/logs${filtersToQuery(next)}`))
  }

  const appListed =
    !filters.app ||
    filters.app === DASHBOARD_APP ||
    apps.some((a) => a.slug === filters.app)
  const modelListed = !filters.model || models.includes(filters.model)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.range}
        onValueChange={(value) => update({ range: value as RangeValue })}
      >
        <SelectTrigger aria-label="Time range" className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {RANGES.map((range) => (
            <SelectItem key={range.value} value={range.value}>
              {range.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(value) => update({ status: value as StatusFilter })}
      >
        <SelectTrigger aria-label="Status" className="w-full sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="error">Error</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.app || ALL}
        onValueChange={(value) => update({ app: value === ALL ? "" : value })}
      >
        <SelectTrigger aria-label="App" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          <SelectItem value={ALL}>All apps</SelectItem>
          <SelectItem value={DASHBOARD_APP}>Dashboard</SelectItem>
          {!appListed && (
            <SelectItem value={filters.app}>{filters.app}</SelectItem>
          )}
          {apps.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                {apps.map((app) => (
                  <SelectItem key={app.slug} value={app.slug}>
                    {app.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      <Select
        value={filters.model || ALL}
        onValueChange={(value) => update({ model: value === ALL ? "" : value })}
      >
        <SelectTrigger aria-label="Model" className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          <SelectItem value={ALL}>All models</SelectItem>
          {!modelListed && (
            <SelectItem value={filters.model}>{filters.model}</SelectItem>
          )}
          {models.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                {models.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    <span className="font-mono text-xs">{slug}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTransition(() => router.push("/logs"))}
          >
            <XIcon />
            Reset
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
    </div>
  )
}
