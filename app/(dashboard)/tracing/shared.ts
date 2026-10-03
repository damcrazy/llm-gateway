export const LANGFUSE_HOSTS = [
  { value: "https://cloud.langfuse.com", label: "Langfuse Cloud (EU)" },
  { value: "https://us.cloud.langfuse.com", label: "Langfuse Cloud (US)" },
] as const

export const LANGFUSE_CUSTOM = "custom"

export interface TraceExportView {
  langfuse: {
    enabled: boolean
    host: string
    publicKey: string
    hasSecret: boolean
  }
  otel: {
    enabled: boolean
    endpoint: string
    headersHint: string | null
  }
  lastSuccessAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}
