// Small pure helpers shared by the apps pages (server and client safe).

import type { ApiKeyRow } from "@/lib/db/types"

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/** ISO timestamp `days` days before now. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** ISO timestamp for the first instant of the current UTC month. */
export function startOfMonthUtc(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString()
}

/** Columns of api_keys that are safe to send to the dashboard (no key_hash). */
export const API_KEY_COLUMNS =
  "id, app_id, name, key_prefix, last_four, expires_at, revoked_at, last_used_at, created_by, created_at"

export type ApiKeyListRow = Omit<ApiKeyRow, "key_hash">

export type KeyStatus = "active" | "revoked" | "expired"

export function keyStatus(
  key: Pick<ApiKeyRow, "revoked_at" | "expires_at">
): KeyStatus {
  if (key.revoked_at) return "revoked"
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return "expired"
  }
  return "active"
}

/** "gw_live_Ab3d…wxyz" */
export function maskKey(key: Pick<ApiKeyRow, "key_prefix" | "last_four">) {
  return `${key.key_prefix}…${key.last_four}`
}

export const EXPIRY_OPTIONS = [
  { value: "never", label: "Never", days: null },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
] as const

export type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"]
