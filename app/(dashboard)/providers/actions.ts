"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireAdmin } from "@/lib/auth"
import type { ProviderConfig } from "@/lib/db/types"
import { invalidateGatewayConfig } from "@/lib/gateway/config"
import { discoverModels, type DiscoveredModel } from "@/lib/gateway/discovery"
import {
  findPreset,
  PROVIDER_TYPE_SPECS,
  type ProviderType,
} from "@/lib/providers/catalog"
import { saveProviderCredentials } from "@/lib/providers/secrets"
import { supabaseAdmin } from "@/lib/supabase/admin"

import {
  DUPLICATE_MODEL_MESSAGE,
  firstIssue,
  newModelSchema,
  UNIQUE_VIOLATION,
  type NewModelInput,
} from "../models/shared"
import {
  cleanConfigFields,
  cleanCredentialFields,
  SLUG_HELP,
  SLUG_PATTERN,
  type FieldValues,
} from "./shared"

const idSchema = z.uuid()
const fieldValuesSchema = z.record(z.string(), z.string())
const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(100, "Name is too long")

const createProviderSchema = z.object({
  presetId: z.string(),
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .min(1, "Enter a slug")
    .max(48, "Slug is too long")
    .regex(SLUG_PATTERN, `Invalid slug. ${SLUG_HELP}`),
  config: fieldValuesSchema,
  credentials: fieldValuesSchema,
})

const updateProviderSchema = z.object({
  name: nameSchema,
  config: fieldValuesSchema,
})

function afterProviderChange(providerId?: string) {
  invalidateGatewayConfig()
  revalidatePath("/providers")
  revalidatePath("/models")
  revalidatePath("/routes")
  if (providerId) revalidatePath(`/providers/${providerId}`)
}

async function loadProvider(id: string): Promise<
  | {
      ok: true
      type: ProviderType
      config: ProviderConfig
      slug: string
      name: string
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabaseAdmin()
    .from("providers")
    .select("type, config, slug, name")
    .eq("id", id)
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Provider not found" }
  return {
    ok: true,
    type: data.type as ProviderType,
    config: (data.config ?? {}) as ProviderConfig,
    slug: data.slug as string,
    name: data.name as string,
  }
}

export async function createProvider(input: {
  presetId: string
  name: string
  slug: string
  config: FieldValues
  credentials: FieldValues
}): Promise<ActionResult<{ id: string }>> {
  await requireAdmin()
  const parsed = createProviderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const preset = findPreset(parsed.data.presetId)
  if (!preset) return { ok: false, error: "Pick a provider preset" }

  const config = cleanConfigFields(preset.type, parsed.data.config)
  if (!config.ok) return config
  const credentials = cleanCredentialFields(
    preset.type,
    parsed.data.credentials
  )
  if (!credentials.ok) return credentials

  const db = supabaseAdmin()
  const { data, error } = await db
    .from("providers")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      type: preset.type,
      config: { ...config.value, preset: preset.id } satisfies ProviderConfig,
    })
    .select("id")
    .single()
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? {
          ok: false,
          error: `A provider with the slug "${parsed.data.slug}" already exists`,
        }
      : actionError(error)
  }
  const id = data.id as string

  try {
    await saveProviderCredentials(id, credentials.value)
  } catch (saveError) {
    // Don't leave a provider behind without its credentials.
    await db.from("providers").delete().eq("id", id)
    return actionError(saveError)
  }

  afterProviderChange()
  return { ok: true, data: { id }, message: `${parsed.data.name} added` }
}

export async function updateProvider(
  id: string,
  input: { name: string; config: FieldValues }
): Promise<ActionResult> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success)
    return { ok: false, error: "Unknown provider" }
  const parsed = updateProviderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const existing = await loadProvider(id)
  if (!existing.ok) return existing
  const cleaned = cleanConfigFields(existing.type, parsed.data.config)
  if (!cleaned.ok) return cleaned

  // Replace the editable fields; keep everything else (preset, headers, …).
  const editable = new Set(
    PROVIDER_TYPE_SPECS[existing.type].configFields.map((f) => f.key)
  )
  const kept = Object.fromEntries(
    Object.entries(existing.config).filter(([key]) => !editable.has(key))
  )

  const { error } = await supabaseAdmin()
    .from("providers")
    .update({ name: parsed.data.name, config: { ...kept, ...cleaned.value } })
    .eq("id", id)
  if (error) return actionError(error)

  afterProviderChange(id)
  return { ok: true, message: "Provider saved" }
}

export async function setProviderEnabled(
  id: string,
  enabled: boolean
): Promise<ActionResult> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success)
    return { ok: false, error: "Unknown provider" }

  const { data, error } = await supabaseAdmin()
    .from("providers")
    .update({ enabled: enabled === true })
    .eq("id", id)
    .select("name")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Provider not found" }

  afterProviderChange(id)
  return {
    ok: true,
    message: `${data.name} ${enabled ? "enabled" : "disabled"}`,
  }
}

export async function replaceProviderCredentials(
  id: string,
  values: FieldValues
): Promise<ActionResult> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success)
    return { ok: false, error: "Unknown provider" }
  const parsedValues = fieldValuesSchema.safeParse(values)
  if (!parsedValues.success) return { ok: false, error: "Invalid credentials" }

  const existing = await loadProvider(id)
  if (!existing.ok) return existing
  const credentials = cleanCredentialFields(existing.type, parsedValues.data)
  if (!credentials.ok) return credentials

  try {
    await saveProviderCredentials(id, credentials.value)
  } catch (error) {
    return actionError(error)
  }

  afterProviderChange(id)
  return { ok: true, message: "Credentials replaced" }
}

export async function deleteProvider(id: string): Promise<ActionResult> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success)
    return { ok: false, error: "Unknown provider" }

  const { data, error } = await supabaseAdmin()
    .from("providers")
    .delete()
    .eq("id", id)
    .select("name")
    .maybeSingle()
  if (error) return actionError(error)

  // No revalidatePath here: it would re-render the (now missing) provider's
  // page as a 404 before the client navigates away. Dynamic pages are
  // refetched on navigation anyway.
  invalidateGatewayConfig()
  return {
    ok: true,
    message: data ? `${data.name} deleted` : "Provider deleted",
  }
}

/** Models the provider's API lists that aren't added yet. */
export async function discoverProviderModels(
  providerId: string
): Promise<ActionResult<{ models: DiscoveredModel[]; total: number }>> {
  await requireAdmin()
  if (!idSchema.safeParse(providerId).success)
    return { ok: false, error: "Unknown provider" }

  const existing = await loadProvider(providerId)
  if (!existing.ok) return existing
  if (!PROVIDER_TYPE_SPECS[existing.type].canDiscoverModels) {
    return {
      ok: false,
      error: "This provider type can't list its models. Add them manually.",
    }
  }

  try {
    const [discovered, { data: current, error }] = await Promise.all([
      discoverModels(providerId),
      supabaseAdmin()
        .from("models")
        .select("model_id")
        .eq("provider_id", providerId),
    ])
    if (error) return actionError(error)
    const added = new Set((current ?? []).map((row) => row.model_id as string))
    const fresh = discovered
      .filter((model) => !added.has(model.model_id))
      .sort((a, b) => a.model_id.localeCompare(b.model_id))
    return { ok: true, data: { models: fresh, total: discovered.length } }
  } catch (error) {
    return actionError(error)
  }
}

const importListSchema = z
  .array(z.unknown())
  .min(1, "Select at least one model")
  .max(1000, "Import at most 1000 models at a time")

/**
 * Listing/catalogue data can be loose: 0 or fractional token counts, and
 * negative prices for "variable" pricing (OpenRouter reports -1).
 */
function tidyDiscovered(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n)
  const tokens = (count: unknown) =>
    finite(count) ? (count > 0 ? Math.round(count) : null) : count
  const price = (amount: unknown) =>
    finite(amount) ? Math.max(0, amount) : amount
  const model = value as Record<string, unknown>
  return {
    ...model,
    tags: model.tags ?? [],
    context_window: tokens(model.context_window),
    max_output_tokens: tokens(model.max_output_tokens),
    input_price_per_mtok: price(model.input_price_per_mtok),
    output_price_per_mtok: price(model.output_price_per_mtok),
    cached_input_price_per_mtok: price(model.cached_input_price_per_mtok),
  }
}

export async function importModels(
  providerId: string,
  models: NewModelInput[]
): Promise<ActionResult<{ imported: number }>> {
  await requireAdmin()
  if (!idSchema.safeParse(providerId).success)
    return { ok: false, error: "Unknown provider" }
  const list = importListSchema.safeParse(models)
  if (!list.success) return { ok: false, error: firstIssue(list.error) }

  // Validate each model on its own so one odd entry doesn't block the rest.
  const valid = new Map<string, z.output<typeof newModelSchema>>()
  const rejected: string[] = []
  for (const item of list.data) {
    const parsed = newModelSchema.safeParse(tidyDiscovered(item))
    if (parsed.success) valid.set(parsed.data.model_id, parsed.data)
    else {
      const id = (item as { model_id?: unknown } | null)?.model_id
      rejected.push(
        `${typeof id === "string" ? id : "unknown"}: ${firstIssue(parsed.error)}`
      )
    }
  }
  if (valid.size === 0) {
    return {
      ok: false,
      error: `Nothing could be imported. ${rejected[0] ?? ""}`.trim(),
    }
  }

  const provider = await loadProvider(providerId)
  if (!provider.ok) return provider

  const rows = [...valid.values()].map((model) => ({
    ...model,
    provider_id: providerId,
    slug: `${provider.slug}/${model.model_id}`,
  }))

  const { data, error } = await supabaseAdmin()
    .from("models")
    .upsert(rows, {
      onConflict: "provider_id,model_id",
      ignoreDuplicates: true,
    })
    .select("id")
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? { ok: false, error: DUPLICATE_MODEL_MESSAGE }
      : actionError(error)
  }

  const imported = data?.length ?? 0
  const existed = rows.length - imported
  const notes = [
    existed > 0 ? `${existed} already existed` : null,
    rejected.length > 0
      ? `${rejected.length} skipped as invalid (${rejected[0]})`
      : null,
  ].filter(Boolean)

  afterProviderChange(providerId)
  return {
    ok: true,
    data: { imported },
    message:
      `Imported ${imported} model${imported === 1 ? "" : "s"}` +
      (notes.length ? `. ${notes.join("; ")}` : ""),
  }
}
