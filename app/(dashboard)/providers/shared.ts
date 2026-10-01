// Helpers shared by the provider pages, forms and server actions.
// No server-only imports: this file is used by client components too.

import type { ProviderConfig, ProviderCredentials } from "@/lib/db/types"
import {
  findPreset,
  PROVIDER_TYPE_SPECS,
  type ProviderPreset,
  type ProviderType,
} from "@/lib/providers/catalog"

export type FieldValues = Record<string, string>

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const SLUG_HELP =
  "Lowercase letters, numbers and dashes, starting with a letter or number."

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function presetOf(
  config: ProviderConfig | null | undefined
): ProviderPreset | undefined {
  return findPreset(config?.preset)
}

/** "Groq" for presets, else the provider type label. */
export function providerKindLabel(
  type: ProviderType,
  config: ProviderConfig | null | undefined
) {
  const typeLabel = PROVIDER_TYPE_SPECS[type]?.label ?? type
  const preset = presetOf(config)
  return {
    typeLabel,
    presetLabel: preset && preset.label !== typeLabel ? preset.label : null,
  }
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname)
  } catch {
    return url
  }
}

/** Base URL, or region / project for cloud providers, for display. */
export function describeEndpoint(
  type: ProviderType,
  config: ProviderConfig | null | undefined
) {
  const c = config ?? {}
  switch (type) {
    case "bedrock":
      return c.region ? `AWS ${c.region}` : "—"
    case "vertex":
      return [c.project, c.location].filter(Boolean).join(" · ") || "—"
    case "anthropic":
      return c.baseUrl ?? "api.anthropic.com (default)"
    case "google":
      return "generativelanguage.googleapis.com"
    default:
      return c.baseUrl ?? "—"
  }
}

type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_FIELD_LENGTH = 20_000

/** Validates the non-secret config fields a provider type declares. */
export function cleanConfigFields(
  type: ProviderType,
  values: FieldValues
): Cleaned<FieldValues> {
  const spec = PROVIDER_TYPE_SPECS[type]
  const clean: FieldValues = {}
  for (const field of spec.configFields) {
    let value = String(values[field.key] ?? "").trim()
    if (!value) {
      if (field.required)
        return { ok: false, error: `${field.label} is required` }
      continue
    }
    if (value.length > 2_000)
      return { ok: false, error: `${field.label} is too long` }
    if (field.key === "baseUrl") {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        return {
          ok: false,
          error: `${field.label} must be a full URL, e.g. https://api.example.com/v1`,
        }
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return {
          ok: false,
          error: `${field.label} must start with http:// or https://`,
        }
      }
      value = value.replace(/\/+$/, "")
    }
    clean[field.key] = value
  }
  return { ok: true, value: clean }
}

/** Validates the secret fields a provider type declares. */
export function cleanCredentialFields(
  type: ProviderType,
  values: FieldValues
): Cleaned<ProviderCredentials> {
  const spec = PROVIDER_TYPE_SPECS[type]
  const clean: Record<string, string> = {}
  for (const field of spec.credentialFields) {
    const value = String(values[field.key] ?? "").trim()
    if (!value) {
      if (field.required)
        return { ok: false, error: `${field.label} is required` }
      continue
    }
    if (value.length > MAX_FIELD_LENGTH)
      return { ok: false, error: `${field.label} is too long` }
    clean[field.key] = value
  }

  const credentials = clean as ProviderCredentials
  if (type === "bedrock") {
    const hasPair = Boolean(
      credentials.accessKeyId && credentials.secretAccessKey
    )
    if (
      Boolean(credentials.accessKeyId) !== Boolean(credentials.secretAccessKey)
    ) {
      return {
        ok: false,
        error: "Enter both the access key ID and the secret access key",
      }
    }
    if (!credentials.apiKey && !hasPair) {
      return {
        ok: false,
        error:
          "Enter a Bedrock API key, or an access key ID and secret access key",
      }
    }
  }
  if (type === "vertex" && credentials.serviceAccountJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(credentials.serviceAccountJson)
    } catch {
      return { ok: false, error: "The service account JSON isn't valid JSON" }
    }
    const key = parsed as {
      client_email?: unknown
      private_key?: unknown
    } | null
    if (
      !key ||
      typeof key.client_email !== "string" ||
      typeof key.private_key !== "string"
    ) {
      return {
        ok: false,
        error:
          "That doesn't look like a service account key file (client_email and private_key are missing)",
      }
    }
  }
  return { ok: true, value: credentials }
}
