"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { audit } from "@/lib/audit"
import { getOrigin, requireMember } from "@/lib/auth"
import { generateInvite, hashInviteCode, hashInviteToken } from "@/lib/crypto"
import { invalidateGatewayConfig } from "@/lib/gateway/config"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { INVITE_DAYS, MAX_PENDING_INVITES } from "./sharing-shared"

// Sharing a provider you own: an invite is a link plus a separate 6-digit
// code; the other person opens the link and enters the code. Only the owner
// can invite (people it's shared with can't pass it on) and the owner can
// take access back at any time. Anyone can also switch off, for their own
// apps, a provider they use but don't own.

const idSchema = z.uuid()

async function ownedProvider(providerId: string, email: string) {
  if (!idSchema.safeParse(providerId).success) return null
  const { data } = await supabaseAdmin()
    .from("providers")
    .select("id, name, owner_email")
    .eq("id", providerId)
    .maybeSingle()
  if (!data || data.owner_email !== email) return null
  return { id: data.id as string, name: data.name as string }
}

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .transform((value) => value || null)
    .pipe(z.email("Enter a valid email address").nullable()),
  days: z.union(INVITE_DAYS.map((d) => z.literal(d.value))),
})

export async function createProviderInvite(
  providerId: string,
  input: z.input<typeof inviteSchema>
): Promise<ActionResult<{ url: string; code: string; expiresAt: string }>> {
  const me = await requireMember()
  const provider = await ownedProvider(providerId, me.email)
  if (!provider)
    return { ok: false, error: "Only the provider's owner can share it" }
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the invite",
    }
  const { email, days } = parsed.data
  if (email === me.email)
    return { ok: false, error: "You already own this provider" }

  const db = supabaseAdmin()
  if (email) {
    const { data: existing } = await db
      .from("provider_shares")
      .select("member_email")
      .eq("provider_id", provider.id)
      .eq("member_email", email)
      .maybeSingle()
    if (existing) return { ok: false, error: `${email} already has access` }
  }
  const { count } = await db
    .from("provider_invites")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", provider.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
  if ((count ?? 0) >= MAX_PENDING_INVITES)
    return {
      ok: false,
      error: `You have ${MAX_PENDING_INVITES} open invites for this provider. Cancel some first.`,
    }

  const invite = generateInvite()
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
  const { data, error } = await db
    .from("provider_invites")
    .insert({
      provider_id: provider.id,
      created_by: me.email,
      token_hash: invite.tokenHash,
      code_hash: invite.codeHash,
      email,
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error) return actionError(error)

  await audit(
    me.email,
    "provider.share_invite",
    email
      ? `Invited ${email} to use provider '${provider.name}'`
      : `Created an invite link for provider '${provider.name}'`,
    { type: "provider", id: provider.id, name: provider.name },
    { inviteId: data.id, email, expiresAt }
  )
  revalidatePath(`/providers/${provider.id}`)
  return {
    ok: true,
    data: {
      url: `${await getOrigin()}/share/${invite.token}`,
      code: invite.code,
      expiresAt,
    },
  }
}

export async function cancelProviderInvite(
  inviteId: string
): Promise<ActionResult> {
  const me = await requireMember()
  if (!idSchema.safeParse(inviteId).success)
    return { ok: false, error: "Unknown invite" }
  const db = supabaseAdmin()
  const { data: invite } = await db
    .from("provider_invites")
    .select("id, provider_id, email, accepted_at, revoked_at")
    .eq("id", inviteId)
    .maybeSingle()
  const provider = invite
    ? await ownedProvider(invite.provider_id as string, me.email)
    : null
  if (!invite || !provider) return { ok: false, error: "Unknown invite" }
  if (invite.accepted_at)
    return { ok: false, error: "That invite was already used" }
  if (!invite.revoked_at) {
    const { error } = await db
      .from("provider_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
    if (error) return actionError(error)
    await audit(
      me.email,
      "provider.share_cancel",
      `Cancelled an invite for provider '${provider.name}'`,
      { type: "provider", id: provider.id, name: provider.name },
      { inviteId, email: invite.email }
    )
  }
  revalidatePath(`/providers/${provider.id}`)
  return { ok: true, message: "Invite cancelled" }
}

export async function revokeProviderShare(
  providerId: string,
  email: string
): Promise<ActionResult> {
  const me = await requireMember()
  const provider = await ownedProvider(providerId, me.email)
  if (!provider) return { ok: false, error: "Provider not found" }
  const { data, error } = await supabaseAdmin()
    .from("provider_shares")
    .delete()
    .eq("provider_id", provider.id)
    .eq("member_email", email.trim().toLowerCase())
    .select("member_email")
  if (error) return actionError(error)
  if (!data?.length) return { ok: false, error: "They no longer have access" }
  invalidateGatewayConfig()
  await audit(
    me.email,
    "provider.share_revoke",
    `Took back access to provider '${provider.name}' from ${data[0]!.member_email}`,
    { type: "provider", id: provider.id, name: provider.name },
    { email: data[0]!.member_email }
  )
  revalidatePath(`/providers/${provider.id}`)
  return {
    ok: true,
    message: `${data[0]!.member_email} can no longer use ${provider.name}`,
  }
}

/** Gives back access to a provider someone shared with you. */
export async function leaveSharedProvider(
  providerId: string
): Promise<ActionResult> {
  const me = await requireMember()
  if (!idSchema.safeParse(providerId).success)
    return { ok: false, error: "Provider not found" }
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("provider_shares")
    .delete()
    .eq("provider_id", providerId)
    .eq("member_email", me.email)
    .select("provider_id")
  if (error) return actionError(error)
  if (!data?.length) return { ok: false, error: "Provider not found" }
  await db
    .from("provider_opt_outs")
    .delete()
    .eq("provider_id", providerId)
    .eq("member_email", me.email)
  const { data: provider } = await db
    .from("providers")
    .select("name, owner_email")
    .eq("id", providerId)
    .maybeSingle()
  invalidateGatewayConfig()
  await audit(
    me.email,
    "provider.share_leave",
    `Stopped using provider '${provider?.name ?? providerId}' shared by ${provider?.owner_email ?? "its owner"}`,
    { type: "provider", id: providerId, name: provider?.name ?? null },
    { owner: provider?.owner_email ?? null }
  )
  revalidatePath("/providers")
  return { ok: true, message: "Removed. Your apps no longer use it." }
}

/**
 * Switches a provider you can use but don't own on or off for your own apps
 * (the gateway's providers, or ones shared with you).
 */
export async function setProviderSwitchedOff(
  providerId: string,
  off: boolean
): Promise<ActionResult> {
  const me = await requireMember()
  if (!idSchema.safeParse(providerId).success)
    return { ok: false, error: "Provider not found" }
  const db = supabaseAdmin()
  const [{ data: provider }, { data: share }] = await Promise.all([
    db
      .from("providers")
      .select("id, name, owner_email")
      .eq("id", providerId)
      .maybeSingle(),
    db
      .from("provider_shares")
      .select("provider_id")
      .eq("provider_id", providerId)
      .eq("member_email", me.email)
      .maybeSingle(),
  ])
  const owner = (provider?.owner_email as string | null) ?? null
  // Your own providers have their own on/off switch for everyone.
  if (!provider || (owner !== null && !share))
    return { ok: false, error: "Provider not found" }
  const { error } = off
    ? await db
        .from("provider_opt_outs")
        .upsert(
          { member_email: me.email, provider_id: providerId },
          { onConflict: "member_email,provider_id", ignoreDuplicates: true }
        )
    : await db
        .from("provider_opt_outs")
        .delete()
        .eq("member_email", me.email)
        .eq("provider_id", providerId)
  if (error) return actionError(error)
  invalidateGatewayConfig()
  await audit(
    me.email,
    off ? "provider.switch_off" : "provider.switch_on",
    `${off ? "Switched off" : "Switched on"} provider '${provider.name}' for their apps`,
    { type: "provider", id: providerId, name: provider.name as string }
  )
  revalidatePath("/providers")
  revalidatePath("/models")
  return {
    ok: true,
    message: off
      ? `${provider.name} is off for your apps`
      : `${provider.name} is on for your apps`,
  }
}

const ACCEPT_ERRORS: Record<string, string> = {
  wrong_code: "That code isn't right. Check it and try again.",
  locked: "Too many wrong codes, so this invite is locked. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
  used: "This invite has already been used.",
  revoked: "This invite was cancelled.",
  not_found: "This invite doesn't exist.",
  own: "This is your own provider.",
  wrong_person:
    "This invite is for a different email address. Sign in with that account to accept it.",
}

export async function acceptProviderInvite(
  token: string,
  code: string
): Promise<ActionResult<{ providerId: string; providerName: string }>> {
  const me = await requireMember()
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
    return { ok: false, error: ACCEPT_ERRORS.not_found! }
  if (!/^\d{6}$/.test(code.trim()))
    return { ok: false, error: "Enter the 6-digit code." }
  const db = supabaseAdmin()
  const tokenHash = hashInviteToken(token)
  const { data: status, error } = await db.rpc("accept_provider_invite", {
    p_token_hash: tokenHash,
    p_code_hash: hashInviteCode(token, code.trim()),
    p_email: me.email,
  })
  if (error) return actionError(error)
  if (status !== "accepted")
    return {
      ok: false,
      error: ACCEPT_ERRORS[status as string] ?? "Couldn't accept the invite.",
    }

  const { data: invite } = await db
    .from("provider_invites")
    .select("provider_id, created_by, providers(name)")
    .eq("token_hash", tokenHash)
    .single()
  const providerId = invite!.provider_id as string
  const providerName =
    (invite!.providers as unknown as { name: string } | null)?.name ??
    "the provider"
  invalidateGatewayConfig()
  await audit(
    me.email,
    "provider.share_accept",
    `Accepted access to provider '${providerName}' from ${invite!.created_by as string}`,
    { type: "provider", id: providerId, name: providerName },
    { owner: invite!.created_by }
  )
  // No revalidatePath: it would re-render the invite page (now used) in this
  // response and replace the success message. Dashboard pages are dynamic.

  return { ok: true, data: { providerId, providerName } }
}
