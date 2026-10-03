export const PAGE_SIZE = 100

export const AREAS = [
  { value: "app", label: "Apps" },
  { value: "api_key", label: "API keys" },
  { value: "provider", label: "Providers" },
  { value: "model", label: "Models" },
  { value: "route", label: "Routes" },
  { value: "member", label: "People" },
  { value: "account", label: "Sign-in & security" },
  { value: "alerts", label: "Alerts" },
  { value: "tracing", label: "Tracing" },
  { value: "prompt", label: "Prompts" },
] as const

export type AuditArea = (typeof AREAS)[number]["value"]
