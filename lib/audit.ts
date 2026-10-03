import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

// The audit log: who changed what in the dashboard, and security events on
// accounts. Admins see every entry; members see their own (RLS on
// public.audit_log). Never put secrets (keys, passwords, tokens, webhook
// URLs) in an entry.

export type AuditTargetType =
  | "app"
  | "api_key"
  | "provider"
  | "model"
  | "route"
  | "member"
  | "account"
  | "alerts"
  | "tracing"
  | "prompt"

export interface AuditTarget {
  type: AuditTargetType
  id?: string | null
  name?: string | null
}

/**
 * Records a change that already happened. A failure to write the entry is
 * logged, not thrown, so it never undoes or hides the change itself.
 */
export async function audit(
  actorEmail: string,
  action: string,
  summary: string,
  target?: AuditTarget,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("audit_log")
      .insert({
        actor_email: actorEmail,
        action,
        summary: summary.slice(0, 500),
        target_type: target?.type ?? null,
        target_id: target?.id ?? null,
        target_name: target?.name?.slice(0, 200) ?? null,
        details: details ?? null,
      })
    if (error) console.error("[audit] failed to record:", action, error.message)
  } catch (error) {
    console.error("[audit] failed to record:", action, error)
  }
}
