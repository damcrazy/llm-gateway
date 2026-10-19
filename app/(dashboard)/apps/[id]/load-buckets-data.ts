import "server-only"

import {
  accessPolicy,
  canUseModel,
  describePolicy,
  providerVisible,
  type ProviderReach,
} from "@/lib/access"
import type {
  AppBucketRow,
  AppRow,
  ModelHealthRow,
  ModelRow,
  UsageBreakdownRow,
} from "@/lib/db/types"
import { loadReach } from "@/lib/provider-reach"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { createClient } from "@/lib/supabase/server"

import { startOfMonthUtc } from "../_lib"
import type { BucketModel, BucketsData, ModelStatus } from "./buckets-shared"

type BucketsApp = Pick<
  AppRow,
  "id" | "owner_email" | "default_model" | "only_bucket_models"
>

/**
 * Everything the Models tab (and the bucket assistant) needs: every model the
 * app's owner can see with price, health and this month's usage, which of
 * them they may add, and the app's buckets. Runs as the signed-in member.
 */
export async function loadBucketsData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  app: BucketsApp
): Promise<{
  data: BucketsData
  /** Every model's slug by id (the Usage tab names models with it). */
  modelSlugs: Map<string, string>
  error: { message: string } | null
}> {
  const [
    modelsResult,
    usageResult,
    bucketsResult,
    healthResult,
    providersResult,
    ownerResult,
    reach,
  ] = await Promise.all([
    supabase
      .from("models")
      .select(
        "id, provider_id, model_id, slug, display_name, kind, enabled, capabilities, context_window, input_price_per_mtok, output_price_per_mtok"
      )
      .order("slug"),
    supabase.rpc("usage_breakdown", {
      p_since: startOfMonthUtc(),
      p_dimension: "model",
      p_app: app.id,
    }),
    supabase
      .from("app_buckets")
      .select("name, position, model_ids, strategy, hedge_after_ms")
      .eq("app_id", app.id)
      .order("position"),
    supabase
      .from("model_health")
      .select("model_id, cooldown_until, consecutive_failures"),
    // Members can't read providers; only names and on/off state are needed.
    supabaseAdmin()
      .from("providers")
      .select("id, name, slug, enabled, owner_email"),
    // Only offer what the app's owner is allowed to call.
    supabase
      .from("members")
      .select("role, model_access, allowed_models")
      .eq("email", app.owner_email)
      .maybeSingle(),
    loadReach(app.owner_email),
  ])

  const models = (modelsResult.data ?? []) as PageModel[]
  const owner = ownerResult.data
  const policy = owner
    ? accessPolicy(owner as Parameters<typeof accessPolicy>[0])
    : { access: "all" as const }
  const buckets = (
    (bucketsResult.data ?? []) as Pick<
      AppBucketRow,
      "name" | "position" | "model_ids" | "strategy" | "hedge_after_ms"
    >[]
  ).map((bucket) => ({
    name: bucket.name,
    modelIds: bucket.model_ids,
    strategy: bucket.strategy ?? "ordered",
    hedgeAfterMs: bucket.hedge_after_ms ?? null,
  }))

  return {
    data: buildBucketsData({
      reach,
      models,
      providers: (providersResult.data ?? []) as {
        id: string
        name: string
        slug: string
        enabled: boolean
        owner_email: string | null
      }[],
      health: (healthResult.data ?? []) as Pick<
        ModelHealthRow,
        "model_id" | "cooldown_until" | "consecutive_failures"
      >[],
      usage: (usageResult.data ?? []) as UsageBreakdownRow[],
      policy,
      buckets,
      app,
    }),
    modelSlugs: new Map(models.map((m) => [m.id, m.slug])),
    error: modelsResult.error ?? usageResult.error ?? bucketsResult.error,
  }
}

type PageModel = Pick<
  ModelRow,
  | "id"
  | "provider_id"
  | "model_id"
  | "slug"
  | "display_name"
  | "kind"
  | "enabled"
  | "capabilities"
  | "context_window"
  | "input_price_per_mtok"
  | "output_price_per_mtok"
>

/** Everything the Models tab shows: each model's price, health and usage. */
export function buildBucketsData({
  reach,
  models,
  providers,
  health,
  usage,
  policy,
  buckets,
  app,
}: {
  models: PageModel[]
  providers: {
    id: string
    name: string
    slug: string
    enabled: boolean
    owner_email: string | null
  }[]
  health: Pick<ModelHealthRow, "model_id" | "cooldown_until">[]
  usage: UsageBreakdownRow[]
  policy: ReturnType<typeof accessPolicy>
  buckets: BucketsData["buckets"]
  app: BucketsApp
  reach: ProviderReach
}): BucketsData {
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const cooldownById = new Map(
    health
      .filter((h) => h.cooldown_until)
      .map((h) => [h.model_id, new Date(h.cooldown_until!).getTime()])
  )
  const usageById = new Map(
    usage.filter((u) => u.id).map((u) => [u.id as string, u])
  )
  const now = Date.now()

  const addable: string[] = []
  // Another member's private provider: those models don't exist for this
  // app, unless its owner shared it with this app's owner.
  const visible = models.filter((model) =>
    providerVisible(
      model.provider_id,
      providerById.get(model.provider_id)?.owner_email ?? null,
      app.owner_email,
      reach
    )
  )
  const bucketModels: BucketModel[] = visible.map((model) => {
    const provider = providerById.get(model.provider_id)
    const ownerEmail = provider?.owner_email ?? null
    const permitted = canUseModel(
      policy,
      model,
      ownerEmail,
      app.owner_email,
      undefined,
      reach
    )
    const switchedOff = reach.switchedOff.has(model.provider_id)
    const cooldownUntil = cooldownById.get(model.id) ?? 0
    let status: ModelStatus = { kind: "ok" }
    if (!model.enabled) {
      status = { kind: "unavailable", label: "Turned off by an admin: skipped" }
    } else if (!provider?.enabled) {
      status = { kind: "unavailable", label: "Its provider is off: skipped" }
    } else if (switchedOff) {
      status = {
        kind: "unavailable",
        label: "Its provider is switched off for your apps: skipped",
      }
    } else if (!permitted) {
      status = {
        kind: "unavailable",
        label: "Not available to this app's owner: skipped",
      }
    } else if (cooldownUntil > now) {
      const minutes = Math.max(1, Math.ceil((cooldownUntil - now) / 60_000))
      status = {
        kind: "cooling",
        label: `Failing recently: tried last for about ${minutes} more min`,
      }
    }
    if (model.enabled && provider?.enabled && permitted) addable.push(model.id)

    const used = usageById.get(model.id)
    const sharedBy =
      ownerEmail && ownerEmail !== app.owner_email ? ownerEmail : null
    return {
      id: model.id,
      slug: model.slug,
      name: model.display_name || model.model_id,
      provider: sharedBy
        ? `${provider?.name ?? "Unknown provider"} (shared by ${sharedBy})`
        : (provider?.name ?? "Unknown provider"),
      providerId: model.provider_id,
      providerName: provider?.name ?? "Unknown provider",
      providerSlug: provider?.slug ?? model.slug.split("/")[0]!,
      source: sharedBy ? "shared" : ownerEmail ? "own" : "gateway",
      sharedBy,
      own: ownerEmail !== null,
      kind: model.kind,
      capabilities: model.capabilities ?? [],
      contextWindow: model.context_window,
      inputPrice:
        model.input_price_per_mtok == null
          ? null
          : Number(model.input_price_per_mtok),
      outputPrice:
        model.output_price_per_mtok == null
          ? null
          : Number(model.output_price_per_mtok),
      status,
      usage: used
        ? {
            requests: Number(used.requests),
            errors: Number(used.errors),
            tokens: Number(used.input_tokens) + Number(used.output_tokens),
            costUsd: Number(used.cost_usd),
          }
        : null,
    }
  })

  return {
    models: bucketModels,
    addable,
    buckets,
    defaultBucket: buckets.some((b) => b.name === app.default_model)
      ? app.default_model
      : null,
    onlyBucketModels: app.only_bucket_models,
    ownerAccess: policy.access === "all" ? null : describePolicy(policy),
  }
}
