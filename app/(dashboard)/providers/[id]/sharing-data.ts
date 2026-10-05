import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

import type { InviteView, ShareView } from "../sharing-shared"

function monthStartUtc(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString()
}

/** Who a provider is shared with (and what they used), and open invites. */
export async function loadSharing(
  providerId: string
): Promise<{ shares: ShareView[]; invites: InviteView[] }> {
  const db = supabaseAdmin()
  const [shares, invites, usage] = await Promise.all([
    db
      .from("provider_shares")
      .select("member_email, created_at")
      .eq("provider_id", providerId)
      .order("created_at"),
    db
      .from("provider_invites")
      .select("id, email, expires_at, created_at, failed_attempts")
      .eq("provider_id", providerId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .lt("failed_attempts", 5)
      .order("created_at", { ascending: false }),
    db
      .from("usage_hourly")
      .select("owner_email, requests, cost_usd")
      .eq("provider_id", providerId)
      .gte("bucket", monthStartUtc()),
  ])
  const used = new Map<string, { requests: number; costUsd: number }>()
  for (const row of (usage.data ?? []) as {
    owner_email: string | null
    requests: number
    cost_usd: number
  }[]) {
    if (!row.owner_email) continue
    const total = used.get(row.owner_email) ?? { requests: 0, costUsd: 0 }
    total.requests += Number(row.requests)
    total.costUsd += Number(row.cost_usd)
    used.set(row.owner_email, total)
  }
  return {
    shares: (
      (shares.data ?? []) as { member_email: string; created_at: string }[]
    ).map((row) => ({
      email: row.member_email,
      since: row.created_at,
      requests: used.get(row.member_email)?.requests ?? 0,
      costUsd: used.get(row.member_email)?.costUsd ?? 0,
    })),
    invites: (
      (invites.data ?? []) as {
        id: string
        email: string | null
        expires_at: string
        created_at: string
        failed_attempts: number
      }[]
    ).map((row) => ({
      id: row.id,
      email: row.email,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      attemptsLeft: 5 - row.failed_attempts,
    })),
  }
}
