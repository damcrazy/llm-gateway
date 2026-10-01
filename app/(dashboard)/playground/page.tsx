import type { Metadata } from "next"
import Link from "next/link"
import { FlaskConicalIcon } from "lucide-react"

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
import { requireAdmin } from "@/lib/auth"
import type { ModelRow, ProviderRow, RouteRow } from "@/lib/db/types"
import { createClient } from "@/lib/supabase/server"

import {
  PlaygroundClient,
  type ModelGroupOption,
  type RouteOption,
} from "./playground-client"

export const metadata: Metadata = { title: "Playground" }

// Playground requests run through a server action on this page. Vercel Hobby
// allows up to 300s; ignored when self-hosted.
export const maxDuration = 300

async function loadOptions() {
  const supabase = await createClient()
  const [routesResult, modelsResult, providersResult] = await Promise.all([
    supabase
      .from("routes")
      .select("name, description, strategy")
      .eq("kind", "chat")
      .eq("enabled", true)
      .order("name"),
    supabase
      .from("models")
      .select("slug, display_name, provider_id")
      .eq("kind", "chat")
      .eq("enabled", true)
      .order("slug"),
    supabase.from("providers").select("id, name, enabled").order("name"),
  ])

  const routes: RouteOption[] = (
    (routesResult.data ?? []) as Pick<
      RouteRow,
      "name" | "description" | "strategy"
    >[]
  ).map((route) => ({
    name: route.name,
    description: route.description,
    strategy: route.strategy,
  }))

  const providers = (providersResult.data ?? []) as Pick<
    ProviderRow,
    "id" | "name" | "enabled"
  >[]
  const models = (modelsResult.data ?? []) as Pick<
    ModelRow,
    "slug" | "display_name" | "provider_id"
  >[]
  // Models of disabled providers can't be served, so leave them out.
  const modelGroups: ModelGroupOption[] = providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      provider: provider.name,
      models: models
        .filter((model) => model.provider_id === provider.id)
        .map((model) => ({
          slug: model.slug,
          displayName: model.display_name,
        })),
    }))
    .filter((group) => group.models.length > 0)

  return { routes, modelGroups }
}

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string | string[] }>
}) {
  await requireAdmin()
  const [{ model: requested }, { routes, modelGroups }] = await Promise.all([
    searchParams,
    loadOptions(),
  ])

  const options = [
    ...routes.map((route) => route.name),
    ...modelGroups.flatMap((group) => group.models.map((model) => model.slug)),
  ]
  const initialModel =
    typeof requested === "string" && options.includes(requested)
      ? requested
      : (options[0] ?? "")

  return (
    <>
      <PageHeader
        title="Playground"
        description="Send test requests through the real gateway pipeline: routing, fallbacks, cooldowns, cost tracking and logging."
      />
      {options.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConicalIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to test yet</EmptyTitle>
            <EmptyDescription>
              Enable a chat model, or create a chat route, and it will show up
              here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" asChild>
              <Link href="/models">Models</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/routes">Routes</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <PlaygroundClient
          routes={routes}
          modelGroups={modelGroups}
          initialModel={initialModel}
        />
      )}
    </>
  )
}
