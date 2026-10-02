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

import { PlaygroundClient, type AppOption } from "./playground-client"

export const metadata: Metadata = { title: "Playground" }

// Playground requests run through a server action on this page. Vercel Hobby
// allows up to 300s; ignored when self-hosted.
export const maxDuration = 300

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string | string[]; app?: string | string[] }>
}) {
  const me = await requireMember()
  const { model: requestedModel, app: requestedApp } = await searchParams

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
          title="Playground"
          description="Try your routes and models before wiring them into code."
        />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxesIcon />
            </EmptyMedia>
            <EmptyTitle>Create an app first</EmptyTitle>
            <EmptyDescription>
              Playground requests run as one of your apps, with its limits and
              usage tracking.
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

  // Admins default to "no app" (unrestricted); members to their first app.
  const initialAppId =
    typeof requestedApp === "string" &&
    apps.some((app) => app.id === requestedApp)
      ? requestedApp
      : me.isAdmin
        ? null
        : apps[0].id
  const context = initialAppId ? await loadAppContext(initialAppId) : null
  const options = await playgroundOptions(context, me.email)
  const names = [
    ...options.routes.map((route) => route.name),
    ...options.modelGroups.flatMap((group) =>
      group.models.map((model) => model.slug)
    ),
  ]
  const initialModel =
    typeof requestedModel === "string" && names.includes(requestedModel)
      ? requestedModel
      : (names[0] ?? "")

  return (
    <>
      <PageHeader
        title="Playground"
        description="Send test requests through the real gateway pipeline: routing, fallbacks, cooldowns, cost tracking and logging."
      />
      <PlaygroundClient
        apps={apps}
        canRunWithoutApp={me.isAdmin}
        initialAppId={initialAppId}
        initialOptions={options}
        initialModel={initialModel}
      />
    </>
  )
}
