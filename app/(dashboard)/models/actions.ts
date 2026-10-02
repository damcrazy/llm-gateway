"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember } from "@/lib/auth"
import {
  requireModelAccess,
  requireModelsAccess,
  requireProviderAccess,
} from "@/lib/provider-access"
import { invalidateGatewayConfig } from "@/lib/gateway/config"
import {
  suggestModelMetadata,
  type DiscoveredModel,
} from "@/lib/gateway/discovery"
import { testModel, type ModelTestResult } from "@/lib/gateway/test-model"
import { supabaseAdmin } from "@/lib/supabase/admin"

import {
  DUPLICATE_MODEL_MESSAGE,
  firstIssue,
  modelFieldsSchema,
  newModelSchema,
  UNIQUE_VIOLATION,
  type ModelFieldsInput,
  type NewModelInput,
} from "./shared"

const idSchema = z.uuid()

function afterModelChange(providerId?: string | null) {
  invalidateGatewayConfig()
  revalidatePath("/models")
  revalidatePath("/providers")
  revalidatePath("/routes")
  if (providerId) revalidatePath(`/providers/${providerId}`)
}

async function providerIdOf(modelId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("models")
    .select("provider_id")
    .eq("id", modelId)
    .maybeSingle()
  return (data?.provider_id as string | undefined) ?? null
}

export async function createModel(
  providerId: string,
  input: NewModelInput
): Promise<ActionResult<{ id: string }>> {
  if (!idSchema.safeParse(providerId).success) {
    await requireMember()
    return { ok: false, error: "Unknown provider" }
  }
  const access = await requireProviderAccess(providerId)
  if (!access.ok) return access
  const parsed = newModelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const db = supabaseAdmin()
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("slug")
    .eq("id", providerId)
    .maybeSingle()
  if (providerError) return actionError(providerError)
  if (!provider) return { ok: false, error: "Provider not found" }

  const { data, error } = await db
    .from("models")
    .insert({
      ...parsed.data,
      provider_id: providerId,
      slug: `${provider.slug}/${parsed.data.model_id}`,
    })
    .select("id")
    .single()
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? { ok: false, error: DUPLICATE_MODEL_MESSAGE }
      : actionError(error)
  }

  afterModelChange(providerId)
  return {
    ok: true,
    data: { id: data.id as string },
    message: `Added ${provider.slug}/${parsed.data.model_id}`,
  }
}

export async function updateModel(
  id: string,
  input: ModelFieldsInput
): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) {
    await requireMember()
    return { ok: false, error: "Unknown model" }
  }
  const access = await requireModelAccess(id)
  if (!access.ok) return access
  const parsed = modelFieldsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { data, error } = await supabaseAdmin()
    .from("models")
    .update(parsed.data)
    .eq("id", id)
    .select("provider_id, slug")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Model not found" }

  afterModelChange(data.provider_id as string)
  return { ok: true, message: `Saved ${data.slug}` }
}

export async function setModelEnabled(
  id: string,
  enabled: boolean
): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) {
    await requireMember()
    return { ok: false, error: "Unknown model" }
  }
  const access = await requireModelAccess(id)
  if (!access.ok) return access

  const { data, error } = await supabaseAdmin()
    .from("models")
    .update({ enabled: enabled === true })
    .eq("id", id)
    .select("provider_id, slug")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Model not found" }

  afterModelChange(data.provider_id as string)
  return {
    ok: true,
    message: `${data.slug} ${enabled ? "enabled" : "disabled"}`,
  }
}

const bulkIdsSchema = z
  .array(z.uuid())
  .min(1, "No models selected")
  .max(5000, "Too many models at once")

/** Enables or disables many models at once (e.g. "all free models shown"). */
export async function setModelsEnabled(
  ids: string[],
  enabled: boolean
): Promise<ActionResult> {
  const parsed = bulkIdsSchema.safeParse([...new Set(ids)])
  if (!parsed.success) {
    await requireMember()
    return { ok: false, error: firstIssue(parsed.error) }
  }
  const access = await requireModelsAccess(parsed.data)
  if (!access.ok) return access

  const db = supabaseAdmin()
  let changed = 0
  // Chunk to keep the PostgREST URL (id=in.(…)) short.
  for (let i = 0; i < parsed.data.length; i += 200) {
    const chunk = parsed.data.slice(i, i + 200)
    const { data, error } = await db
      .from("models")
      .update({ enabled: enabled === true })
      .in("id", chunk)
      .select("id")
    if (error) return actionError(error)
    changed += data?.length ?? 0
  }

  afterModelChange()
  revalidatePath("/providers", "layout")
  return {
    ok: true,
    message: `${changed} model${changed === 1 ? "" : "s"} ${enabled ? "enabled" : "disabled"}`,
  }
}

export async function deleteModel(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) {
    await requireMember()
    return { ok: false, error: "Unknown model" }
  }
  const access = await requireModelAccess(id)
  if (!access.ok) return access

  const { data, error } = await supabaseAdmin()
    .from("models")
    .delete()
    .eq("id", id)
    .select("provider_id, slug")
    .maybeSingle()
  if (error) return actionError(error)

  afterModelChange(data?.provider_id as string | undefined)
  return { ok: true, message: data ? `Deleted ${data.slug}` : "Model deleted" }
}

export async function resetModelHealth(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) {
    await requireMember()
    return { ok: false, error: "Unknown model" }
  }
  const access = await requireModelAccess(id)
  if (!access.ok) return access

  const { error } = await supabaseAdmin()
    .from("model_health")
    .delete()
    .eq("model_id", id)
  if (error) return actionError(error)

  afterModelChange(await providerIdOf(id))
  return { ok: true, message: "Health reset. The model is back in rotation." }
}

export async function runModelTest(
  id: string
): Promise<ActionResult<ModelTestResult>> {
  if (!idSchema.safeParse(id).success) {
    await requireMember()
    return { ok: false, error: "Unknown model" }
  }
  const access = await requireModelAccess(id)
  if (!access.ok) return access

  try {
    const result = await testModel(id)
    // A test may update model_health, so refresh the health badges.
    revalidatePath("/models")
    const providerId = await providerIdOf(id)
    if (providerId) revalidatePath(`/providers/${providerId}`)
    return { ok: true, data: result }
  } catch (error) {
    return actionError(error)
  }
}

export async function suggestMetadata(
  providerId: string,
  modelId: string
): Promise<ActionResult<DiscoveredModel | null>> {
  if (!idSchema.safeParse(providerId).success) {
    await requireMember()
    return { ok: false, error: "Unknown provider" }
  }
  const access = await requireProviderAccess(providerId)
  if (!access.ok) return access
  const trimmed = modelId.trim()
  if (!trimmed) return { ok: false, error: "Enter a model id first" }

  try {
    return { ok: true, data: await suggestModelMetadata(providerId, trimmed) }
  } catch (error) {
    return actionError(error)
  }
}
