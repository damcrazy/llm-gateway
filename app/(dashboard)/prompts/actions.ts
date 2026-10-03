"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { audit } from "@/lib/audit"
import { requireMember, type SessionMember } from "@/lib/auth"
import { forgetPrompt } from "@/lib/gateway/prompts"
import { promptVariables, PROMPT_SLUG_PATTERN } from "@/lib/prompt-template"
import { supabaseAdmin } from "@/lib/supabase/admin"

import {
  MAX_DESCRIPTION_CHARS,
  MAX_MAX_TOKENS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_MODEL_CHARS,
  MAX_NAME_CHARS,
  MAX_NOTE_CHARS,
  MAX_SLUG_CHARS,
  MAX_TEMPERATURE,
  STARTER_MESSAGES,
} from "./shared"

const idSchema = z.uuid()

const infoSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(MAX_NAME_CHARS, `Names can be up to ${MAX_NAME_CHARS} characters`),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(MAX_SLUG_CHARS, `Slugs can be up to ${MAX_SLUG_CHARS} characters`)
    .regex(
      PROMPT_SLUG_PATTERN,
      "Slugs use lowercase letters, numbers, dots, dashes and underscores, and start with a letter or number"
    ),
  description: z
    .string()
    .trim()
    .max(
      MAX_DESCRIPTION_CHARS,
      `Descriptions can be up to ${MAX_DESCRIPTION_CHARS} characters`
    )
    .transform((value) => value || null),
})

export type PromptInfoInput = z.input<typeof infoSchema>

const versionSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"], "Pick a role"),
        content: z
          .string()
          .max(
            MAX_MESSAGE_CHARS,
            `A message can be up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters`
          ),
      })
    )
    .min(1, "Add at least one message")
    .max(MAX_MESSAGES, `A prompt can have up to ${MAX_MESSAGES} messages`)
    .refine((messages) => messages.every((m) => m.content.trim()), {
      message: "Fill in or remove the empty message",
    }),
  model: z
    .string()
    .trim()
    .max(
      MAX_MODEL_CHARS,
      `The model can be up to ${MAX_MODEL_CHARS} characters`
    )
    .transform((value) => value || null),
  temperature: z
    .number("Temperature must be a number")
    .min(0, "Temperature can't be below 0")
    .max(MAX_TEMPERATURE, `Temperature can be at most ${MAX_TEMPERATURE}`)
    .nullable(),
  maxTokens: z
    .number("Max tokens must be a number")
    .int("Max tokens must be a whole number")
    .min(1, "Max tokens must be at least 1")
    .max(
      MAX_MAX_TOKENS,
      `Max tokens can be at most ${MAX_MAX_TOKENS.toLocaleString("en-US")}`
    )
    .nullable(),
  note: z
    .string()
    .trim()
    .max(MAX_NOTE_CHARS, `Notes can be up to ${MAX_NOTE_CHARS} characters`)
    .transform((value) => value || null),
})

export type PromptVersionInput = z.input<typeof versionSchema>

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input"
}

interface PromptAccess {
  me: SessionMember
  prompt: {
    id: string
    owner_email: string
    slug: string
    name: string
    published_version: number | null
  }
}

/**
 * Owners may change their own prompts; admins may change any. Returns the
 * caller and the prompt, or an error result.
 */
async function requirePromptAccess(
  id: string
): Promise<PromptAccess | { ok: false; error: string }> {
  const me = await requireMember()
  if (!idSchema.safeParse(id).success)
    return { ok: false, error: "Unknown prompt" }
  const { data, error } = await supabaseAdmin()
    .from("prompts")
    .select("id, owner_email, slug, name, published_version")
    .eq("id", id)
    .maybeSingle()
  if (error) return actionError(error)
  if (!data || (!me.isAdmin && data.owner_email !== me.email))
    return { ok: false, error: "Unknown prompt" }
  return { me, prompt: data as PromptAccess["prompt"] }
}

function isDenied(
  value: PromptAccess | { ok: false; error: string }
): value is { ok: false; error: string } {
  return "ok" in value
}

function duplicateSlug(me: SessionMember, owner: string, slug: string) {
  return {
    ok: false as const,
    error:
      owner === me.email
        ? `You already have a prompt called '${slug}'`
        : `${owner} already has a prompt called '${slug}'`,
  }
}

function revalidatePrompt(id?: string) {
  revalidatePath("/prompts")
  if (id) revalidatePath(`/prompts/${id}`)
}

export async function createPrompt(
  input: PromptInfoInput
): Promise<ActionResult<{ id: string }>> {
  const me = await requireMember()
  const parsed = infoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { name, slug, description } = parsed.data

  const db = supabaseAdmin()
  const { data, error } = await db
    .from("prompts")
    .insert({ owner_email: me.email, name, slug, description })
    .select("id")
    .single()
  if (error) {
    return error.code === "23505"
      ? duplicateSlug(me, me.email, slug)
      : actionError(error)
  }
  const id = data.id as string

  const { error: versionError } = await db.from("prompt_versions").insert({
    prompt_id: id,
    version: 1,
    messages: STARTER_MESSAGES,
    model: null,
    params: {},
    note: "Starter template",
    created_by: me.email,
  })
  if (versionError) {
    // Don't leave a prompt without any version behind.
    await db.from("prompts").delete().eq("id", id)
    return actionError(versionError)
  }

  await audit(
    me.email,
    "prompt.create",
    `Created prompt '${name}'`,
    { type: "prompt", id, name },
    { slug, description }
  )
  // The gateway may have cached "no such prompt" for this slug.
  forgetPrompt(me.email, slug)
  revalidatePrompt()
  return { ok: true, data: { id }, message: `Created ${name}` }
}

export async function updatePromptInfo(
  id: string,
  input: PromptInfoInput
): Promise<ActionResult> {
  const access = await requirePromptAccess(id)
  if (isDenied(access)) return access
  const { me, prompt } = access
  const parsed = infoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { name, slug, description } = parsed.data

  const { error } = await supabaseAdmin()
    .from("prompts")
    .update({ name, slug, description })
    .eq("id", id)
  if (error) {
    return error.code === "23505"
      ? duplicateSlug(me, prompt.owner_email, slug)
      : actionError(error)
  }

  await audit(
    me.email,
    "prompt.update",
    prompt.slug === slug
      ? `Changed details of prompt '${name}'`
      : `Renamed prompt '${prompt.slug}' to '${slug}'`,
    { type: "prompt", id, name },
    {
      name,
      slug,
      description,
      ...(prompt.slug === slug ? {} : { previousSlug: prompt.slug }),
    }
  )
  forgetPrompt(prompt.owner_email, prompt.slug)
  if (slug !== prompt.slug) forgetPrompt(prompt.owner_email, slug)
  revalidatePrompt(id)
  return { ok: true, message: "Details saved" }
}

/**
 * Saves the messages and defaults as a new version (the highest number plus
 * one). Versions never change once saved.
 */
export async function savePromptVersion(
  id: string,
  input: PromptVersionInput
): Promise<ActionResult<{ version: number }>> {
  const access = await requirePromptAccess(id)
  if (isDenied(access)) return access
  const { me, prompt } = access
  const parsed = versionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const value = parsed.data

  const params: Record<string, number> = {}
  if (value.temperature != null) params.temperature = value.temperature
  if (value.maxTokens != null) params.max_tokens = value.maxTokens

  const db = supabaseAdmin()
  let saved: number | null = null
  // Two saves at once can pick the same number; the unique index rejects
  // the second, which then tries the next number.
  for (let attempt = 0; attempt < 3 && saved === null; attempt++) {
    const { data: latest, error: latestError } = await db
      .from("prompt_versions")
      .select("version")
      .eq("prompt_id", id)
      .order("version", { ascending: false })
      .limit(1)
    if (latestError) return actionError(latestError)
    const next = ((latest?.[0]?.version as number | undefined) ?? 0) + 1
    const { error } = await db.from("prompt_versions").insert({
      prompt_id: id,
      version: next,
      messages: value.messages,
      model: value.model,
      params,
      note: value.note,
      created_by: me.email,
    })
    if (!error) saved = next
    else if (error.code === "23503")
      return { ok: false, error: "This prompt no longer exists" }
    else if (error.code !== "23505") return actionError(error)
  }
  if (saved === null) {
    return {
      ok: false,
      error: "Someone saved a version at the same time. Try again.",
    }
  }

  // Bumps updated_at (a trigger sets it) so the list shows recent activity.
  await db
    .from("prompts")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)

  await audit(
    me.email,
    "prompt.version",
    `Saved version ${saved} of prompt '${prompt.name}'`,
    { type: "prompt", id, name: prompt.name },
    {
      version: saved,
      note: value.note,
      model: value.model,
      params,
      messages: value.messages.length,
      variables: promptVariables(value.messages),
    }
  )
  forgetPrompt(prompt.owner_email, prompt.slug)
  revalidatePrompt(id)
  return {
    ok: true,
    data: { version: saved },
    message:
      prompt.published_version == null
        ? `Saved version ${saved}. Apps use it now.`
        : `Saved version ${saved}. Apps still get version ${prompt.published_version} until you publish it.`,
  }
}

/** Which version apps get when they don't ask for one (null: the latest). */
export async function setPublishedVersion(
  id: string,
  version: number | null
): Promise<ActionResult> {
  const access = await requirePromptAccess(id)
  if (isDenied(access)) return access
  const { me, prompt } = access
  const parsed = z.number().int().positive().nullable().safeParse(version)
  if (!parsed.success) return { ok: false, error: "Unknown version" }

  const db = supabaseAdmin()
  if (parsed.data !== null) {
    const { data, error } = await db
      .from("prompt_versions")
      .select("id")
      .eq("prompt_id", id)
      .eq("version", parsed.data)
      .maybeSingle()
    if (error) return actionError(error)
    if (!data)
      return { ok: false, error: `Version ${parsed.data} doesn't exist` }
  }

  const { error } = await db
    .from("prompts")
    .update({ published_version: parsed.data })
    .eq("id", id)
  if (error) return actionError(error)

  await audit(
    me.email,
    "prompt.publish",
    parsed.data === null
      ? `Prompt '${prompt.name}' now uses its latest version`
      : `Published version ${parsed.data} of prompt '${prompt.name}'`,
    { type: "prompt", id, name: prompt.name },
    { version: parsed.data, previous: prompt.published_version }
  )
  forgetPrompt(prompt.owner_email, prompt.slug)
  revalidatePrompt(id)
  return {
    ok: true,
    message:
      parsed.data === null
        ? "Apps now get the latest version"
        : `Apps now get version ${parsed.data}`,
  }
}

export async function deletePrompt(id: string): Promise<ActionResult> {
  const access = await requirePromptAccess(id)
  if (isDenied(access)) return access
  const { me, prompt } = access

  const { error } = await supabaseAdmin().from("prompts").delete().eq("id", id)
  if (error) return actionError(error)

  await audit(me.email, "prompt.delete", `Deleted prompt '${prompt.name}'`, {
    type: "prompt",
    id,
    name: prompt.name,
  })
  forgetPrompt(prompt.owner_email, prompt.slug)
  // No revalidatePath here on purpose: it would re-render this prompt's page
  // in the action response and flash a 404. The client navigates to
  // /prompts instead, and dashboard pages are dynamic.
  return { ok: true, message: "Prompt deleted" }
}
