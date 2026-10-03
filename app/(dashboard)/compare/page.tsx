import type { Metadata } from "next"
import Link from "next/link"
import { BoxesIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { requireMember } from "@/lib/auth"
import type { AppRow } from "@/lib/db/types"
import { loadAppContext } from "@/lib/gateway/auth"
import { playgroundOptions } from "@/lib/gateway/playground"
import { createClient } from "@/lib/supabase/server"

import type { AppOption } from "../playground/playground-client"
import { CompareClient } from "./compare-client"
import { promptPrefill, replayPrefill } from "./load"
import type { ComparePrefill } from "./shared"

export const metadata: Metadata = { title: "Compare" }

// Each model runs through a server action on this page. Vercel Hobby allows
// up to 300s; ignored when self-hosted.
export const maxDuration = 300

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const me = await requireMember()
  const params = await searchParams
  const requestId = first(params.request)
  const promptId = first(params.prompt)
  const version = Number(first(params.version)) || null

  // RLS: admins see every app, members only their own.
  const supabase = await createClient()
  const { data } = await supabase
    .from("apps")
    .select("id, name, owner_email, enabled")
    .order("name")
  const apps: AppOption[] = (
    (data ?? []) as Pick<AppRow, "id" | "name" | "owner_email" | "enabled">[]
  ).map((app) => ({
    id: app.id,
    name: app.name,
    owner: app.owner_email === me.email ? null : app.owner_email,
    enabled: app.enabled,
  }))

  if (!me.isAdmin && apps.length === 0) {
    return (
      <>
        <PageHeader
          title="Compare"
          description="Send the same conversation to several models side by side."
        />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxesIcon />
            </EmptyMedia>
            <EmptyTitle>Create an app first</EmptyTitle>
            <EmptyDescription>
              Comparisons run as one of your apps, with its limits and usage
              tracking.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/apps">Go to apps</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    )
  }

  const prefill: ComparePrefill | null = requestId
    ? await replayPrefill(me, requestId)
    : promptId
      ? await promptPrefill(me, promptId, version)
      : null

  // A replay runs as the original app when the viewer may use it.
  const wantedApp = prefill && prefill.source !== "error" ? prefill.appId : null
  const initialAppId =
    wantedApp && apps.some((app) => app.id === wantedApp)
      ? wantedApp
      : me.isAdmin
        ? null
        : apps[0].id
  const context = initialAppId ? await loadAppContext(initialAppId) : null
  const options = await playgroundOptions(context, me.email)
  const names = [
    ...options.buckets.map((bucket) => bucket.name),
    ...options.routes.map((route) => route.name),
    ...options.modelGroups.flatMap((group) =>
      group.models.map((model) => model.slug)
    ),
  ]
  const prefillModel =
    prefill && prefill.source !== "error" ? prefill.model : null
  const firstModel =
    prefillModel && names.includes(prefillModel) ? prefillModel : names[0]
  const initialModels = [
    firstModel,
    names.find((name) => name !== firstModel),
  ].filter((name): name is string => Boolean(name))

  return (
    <>
      <PageHeader
        title="Compare"
        description="Send the same conversation to several models at once and compare answers, speed and cost. Requests run through the real gateway and show up in Logs."
      />
      <CompareClient
        apps={apps}
        canRunWithoutApp={me.isAdmin}
        initialAppId={initialAppId}
        initialOptions={options}
        initialModels={initialModels}
        prefill={prefill}
      />
    </>
  )
}
