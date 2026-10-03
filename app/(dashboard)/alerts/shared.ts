export type AlertSeverity = "info" | "warning" | "critical"
export type AlertKind = "budget" | "model_down" | "latency" | "test"

export interface AlertItem {
  id: string
  createdAt: string
  kind: AlertKind
  severity: AlertSeverity
  title: string
  body: string
  appId: string | null
  read: boolean
  /** null: no webhook; "sent"; otherwise why posting failed. */
  delivery: string | null
}

export const ALERT_COLUMNS =
  "id, created_at, kind, severity, title, body, app_id, read_at, delivery"

export function toAlertItem(row: Record<string, unknown>): AlertItem {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    kind: row.kind as AlertKind,
    severity: row.severity as AlertSeverity,
    title: row.title as string,
    body: row.body as string,
    appId: (row.app_id as string | null) ?? null,
    read: row.read_at != null,
    delivery: (row.delivery as string | null) ?? null,
  }
}

export const KIND_LABELS: Record<AlertKind, string> = {
  budget: "Budget",
  model_down: "Failing model",
  latency: "Slow responses",
  test: "Test",
}

export const BUDGET_OPTIONS = [50, 75, 80, 90] as const

export const LATENCY_OFF = "off"
export const LATENCY_OPTIONS = [
  { value: LATENCY_OFF, label: "Off" },
  { value: "2000", label: "Above 2 s" },
  { value: "5000", label: "Above 5 s" },
  { value: "10000", label: "Above 10 s" },
  { value: "30000", label: "Above 30 s" },
] as const
