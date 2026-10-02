"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { accessPolicy, canUseModel, describePolicy } from "@/lib/access"
import { requireMember, type SessionMember } from "@/lib/auth"
import { generateApiKey } from "@/lib/crypto"
import type { MemberRow, ModelRow } from "@/lib/db/types"
import { invalidateApiKeyCache } from "@/lib/gateway/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"

import {
  BUCKET_NAME_PATTERN,
  EXPIRY_OPTIONS,
  MAX_BUCKET_MODELS,
  MAX_BUCKETS,
  SLUG_PATTERN,
  type ExpiryValue,
} from "./_lib"

const idSchema = z.uuid()

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name is too long")

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Description is too long")
  .transform((value) => value || null)

const createAppSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(48, "Slug is too long")
    .regex(
      SLUG_PATTERN,
      "Slug may only contain lowercase letters, numbers and dashes, and must start with a letter or number"
    ),
  description: descriptionSchema,
})

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input"
}

/**
 * Members may only touch their own apps; admins may touch any. Returns the
 * caller, or an error result when the app isn't theirs (or doesn't exist).
 */
async function requireAppAccess(
  appId: string
): Promise<SessionMember | { ok: false; error: string }> {
  const me = await requireMember()
  if (!idSchema.safeParse(appId).success)
    return { ok: false, error: "Unknown app" }
  if (me.isAdmin) return me
  const { data } = await supabaseAdmin()
    .from("apps")
    .select("owner_email")
    .eq("id", appId)
    .maybeSingle()
  if (!data || data.owner_email !== me.email) {
    return { ok: false, error: "Unknown app" }
  }
  return me
}

function isDenied(
  value: SessionMember | { ok: false; error: string }
): value is { ok: false; error: string } {
  return "ok" in value
}

function revalidateApp(id?: string) {
  revalidatePath("/apps")
  if (id) revalidatePath(`/apps/${id}`)
}

export async function createApp(
  input: z.input<typeof createAppSchema>
): Promise<ActionResult<{ id: string }>> {
  const me = await requireMember()
  const parsed = createAppSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { data, error } = await supabaseAdmin()
    .from("apps")
    .insert({ ...parsed.data, owner_email: me.email, created_by: me.email })
    .select("id")
    .single()
  if (error) {
    return error.code === "23505"
      ? { ok: false, error: `The slug "${parsed.data.slug}" is already taken` }
      : actionError(error)
  }

  invalidateApiKeyCache()
  revalidateApp()
  return {
    ok: true,
    data: { id: data.id as string },
    message: `Created ${parsed.data.name}`,
  }
}

const settingsSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  monthlyBudgetUsd: z
    .number("Budget must be a number")
    .min(0, "Budget cannot be negative")
    .max(10_000_000, "Budget is too large")
    .nullable(),
  rpmLimit: z
    .number("RPM limit must be a number")
    .int("RPM limit must be a whole number")
    .positive("RPM limit must be greater than zero")
    .max(1_000_000, "RPM limit is too large")
    .nullable(),
  logPayloads: z.boolean(),
})

export type AppSettingsInput = z.input<typeof settingsSchema>

export async function updateAppSettings(
  id: string,
  input: AppSettingsInput
): Promise<ActionResult> {
  const access = await requireAppAccess(id)
  if (isDenied(access)) return access
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const s = parsed.data

  const { error } = await supabaseAdmin()
    .from("apps")
    .update({
      name: s.name,
      description: s.description,
      monthly_budget_usd: s.monthlyBudgetUsd,
      rpm_limit: s.rpmLimit,
      log_payloads: s.logPayloads,
    })
    .eq("id", id)
  if (error) return actionError(error)

  invalidateApiKeyCache()
  revalidateApp(id)
  return { ok: true, message: "Settings saved" }
}

type OwnerAccess = Pick<MemberRow, "role" | "model_access" | "allowed_models">
type PricedModel = Pick<
  ModelRow,
  "id" | "slug" | "input_price_per_mtok" | "output_price_per_mtok"
> & { providers: { owner_email: string | null } | null }

const bucketsSchema = z
  .object({
    buckets: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .min(1, "Give the bucket a name")
            .max(40, "Bucket names can be up to 40 characters")
            .regex(
              BUCKET_NAME_PATTERN,
              "Bucket names use lowercase letters, numbers, dots, dashes and underscores"
            )
            .refine((name) => name !== "default", {
              message:
                '"default" is reserved: clients send it to mean the default bucket',
            }),
          modelIds: z
            .array(z.uuid())
            .max(
              MAX_BUCKET_MODELS,
              `A bucket can hold up to ${MAX_BUCKET_MODELS} models`
            )
            .transform((ids) => [...new Set(ids)]),
        })
      )
      .max(MAX_BUCKETS, `An app can have up to ${MAX_BUCKETS} buckets`),
    defaultBucket: z.string().nullable(),
    onlyBucketModels: z.boolean(),
  })
  .refine(
    (value) =>
      new Set(value.buckets.map((b) => b.name)).size === value.buckets.length,
    { message: "Two buckets have the same name" }
  )
  .refine(
    (value) =>
      value.defaultBucket === null ||
      value.buckets.some((b) => b.name === value.defaultBucket),
    { message: "The default must be one of the buckets" }
  )

export type AppBucketsInput = z.input<typeof bucketsSchema>

/**
 * Saves an app's buckets (named, ordered model chains), its default bucket
 * and whether it may call anything outside them, in one transaction.
 */
export async function saveAppBuckets(
  id: string,
  input: AppBucketsInput
): Promise<ActionResult> {
  const access = await requireAppAccess(id)
  if (isDenied(access)) return access
  const parsed = bucketsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const value = parsed.data

  // Every model must exist and be one the app's owner is allowed to call.
  const db = supabaseAdmin()
  const modelIds = [...new Set(value.buckets.flatMap((b) => b.modelIds))]
  const [{ data: app }, { data: models, error: modelsError }] =
    await Promise.all([
      db
        .from("apps")
        .select("owner_email, members(role, model_access, allowed_models)")
        .eq("id", id)
        .maybeSingle(),
      modelIds.length
        ? db
            .from("models")
            .select(
              "id, slug, input_price_per_mtok, output_price_per_mtok, providers(owner_email)"
            )
            .in("id", modelIds)
        : Promise.resolve({ data: [], error: null }),
    ])
  if (modelsError) return actionError(modelsError)
  const appRow = app as {
    owner_email: string
    members: OwnerAccess | null
  } | null
  const owner = appRow?.members
  if (!appRow || !owner) return { ok: false, error: "Unknown app" }
  const policy = accessPolicy(owner)
  const found = new Map(
    ((models ?? []) as PricedModel[]).map((model) => [model.id, model])
  )
  for (const modelId of modelIds) {
    const model = found.get(modelId)
    if (!model)
      return { ok: false, error: "One of the models no longer exists" }
    const providerOwner = model.providers?.owner_email ?? null
    if (providerOwner !== null && providerOwner !== appRow.owner_email)
      return { ok: false, error: "One of the models no longer exists" }
    if (!canUseModel(policy, model, providerOwner, appRow.owner_email)) {
      return {
        ok: false,
        error: `${model.slug} isn't available to this app's owner (${describePolicy(policy)})`,
      }
    }
  }

  const { error } = await db.rpc("save_app_buckets", {
    p_app_id: id,
    p_buckets: value.buckets.map((b) => ({
      name: b.name,
      model_ids: b.modelIds,
    })),
    p_default: value.defaultBucket,
    p_only_bucket_models: value.onlyBucketModels,
  })
  if (error) return actionError(error)

  invalidateApiKeyCache()
  revalidateApp(id)
  return { ok: true, message: "Buckets saved" }
}

export async function setAppEnabled(
  id: string,
  enabled: boolean
): Promise<ActionResult> {
  const access = await requireAppAccess(id)
  if (isDenied(access)) return access

  const { error } = await supabaseAdmin()
    .from("apps")
    .update({ enabled: enabled === true })
    .eq("id", id)
  if (error) return actionError(error)

  invalidateApiKeyCache()
  revalidateApp(id)
  return {
    ok: true,
    message: enabled
      ? "App enabled"
      : "App disabled. Its keys are rejected until you enable it again.",
  }
}

export async function deleteApp(id: string): Promise<ActionResult> {
  const access = await requireAppAccess(id)
  if (isDenied(access)) return access

  const { error } = await supabaseAdmin().from("apps").delete().eq("id", id)
  if (error) return actionError(error)

  invalidateApiKeyCache()
  // No revalidatePath here on purpose: revalidating makes Next re-render the
  // current page (/apps/[id]) in the action response, which would flash a
  // 404. The client navigates to /apps instead, and dashboard pages are
  // dynamic, so it renders fresh data.
  return { ok: true, message: "App and its keys deleted" }
}

const createKeySchema = z.object({
  name: nameSchema,
  expiry: z.enum(["never", "30", "90", "365"] satisfies ExpiryValue[]),
})

export async function createApiKey(
  appId: string,
  input: z.input<typeof createKeySchema>
): Promise<ActionResult<{ key: string }>> {
  const me = await requireAppAccess(appId)
  if (isDenied(me)) return me
  const parsed = createKeySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const days =
    EXPIRY_OPTIONS.find((o) => o.value === parsed.data.expiry)?.days ?? null
  const expiresAt = days
    ? new Date(Date.now() + days * 86_400_000).toISOString()
    : null
  const generated = generateApiKey()

  const { error } = await supabaseAdmin().from("api_keys").insert({
    app_id: appId,
    name: parsed.data.name,
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    last_four: generated.lastFour,
    expires_at: expiresAt,
    created_by: me.email,
  })
  if (error) {
    return error.code === "23503"
      ? { ok: false, error: "This app no longer exists" }
      : actionError(error)
  }

  invalidateApiKeyCache()
  revalidateApp(appId)
  return { ok: true, data: { key: generated.key }, message: "Key created" }
}

export async function revokeApiKey(
  appId: string,
  keyId: string
): Promise<ActionResult> {
  const access = await requireAppAccess(appId)
  if (isDenied(access)) return access
  if (!idSchema.safeParse(keyId).success) {
    return { ok: false, error: "Unknown key" }
  }

  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("app_id", appId)
    .is("revoked_at", null)
    .select("name")
  if (error) return actionError(error)
  if (!data?.length)
    return { ok: false, error: "Key not found or already revoked" }

  invalidateApiKeyCache()
  revalidateApp(appId)
  return { ok: true, message: `Revoked ${data[0].name as string}` }
}
