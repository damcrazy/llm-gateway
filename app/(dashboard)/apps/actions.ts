"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember, type SessionMember } from "@/lib/auth"
import { generateApiKey } from "@/lib/crypto"
import { invalidateApiKeyCache } from "@/lib/gateway/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { EXPIRY_OPTIONS, SLUG_PATTERN, type ExpiryValue } from "./_lib"

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

const settingsSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    allowedModels: z
      .array(z.string().trim().min(1).max(200))
      .max(200, "Too many allowed models")
      .transform((values) => [...new Set(values)]),
    defaultModel: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .transform((value) => value || null),
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
  .refine(
    (value) =>
      !value.defaultModel ||
      value.allowedModels.length === 0 ||
      value.allowedModels.includes(value.defaultModel),
    { message: "The default model must be one of the allowed models" }
  )

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
      allowed_models: s.allowedModels,
      default_model: s.defaultModel,
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
