// Provider types (code) and presets (data). A provider *type* is an adapter
// the gateway knows how to talk to; a *preset* just pre-fills the base URL for
// a well-known OpenAI-compatible service. Anything else that speaks the
// OpenAI API can be added as "Custom (OpenAI-compatible)".

export const PROVIDER_TYPES = [
  "openai_compatible",
  "azure_openai",
  "anthropic",
  "bedrock",
  "vertex",
  "google",
] as const

export type ProviderType = (typeof PROVIDER_TYPES)[number]

export const CAPABILITIES = [
  "tools",
  "vision",
  "json_schema",
  "reasoning",
  "pdf",
  "audio",
  "prompt_caching",
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const CAPABILITY_LABELS: Record<Capability, string> = {
  tools: "Tool calling",
  vision: "Vision",
  json_schema: "Structured output",
  reasoning: "Reasoning",
  pdf: "PDF input",
  audio: "Audio input",
  prompt_caching: "Prompt caching",
}

export const SUGGESTED_TAGS = [
  "fast",
  "cheap",
  "free",
  "coding",
  "frontier",
  "long-context",
  "local",
] as const

export type FieldSpec = {
  key: string
  label: string
  placeholder?: string
  help?: string
  required?: boolean
  multiline?: boolean
}

export interface ProviderTypeSpec {
  type: ProviderType
  label: string
  description: string
  /** Non-secret fields stored in providers.config. */
  configFields: FieldSpec[]
  /** Secret fields, encrypted at rest. */
  credentialFields: FieldSpec[]
  /** Whether the gateway can list models from the provider's API. */
  canDiscoverModels: boolean
  /** Key prefix in LiteLLM's model catalogue, used to prefill metadata. */
  metadataPrefix?: string
}

export const PROVIDER_TYPE_SPECS: Record<ProviderType, ProviderTypeSpec> = {
  openai_compatible: {
    type: "openai_compatible",
    label: "OpenAI-compatible",
    description:
      "OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Together, Ollama, vLLM and anything else that speaks the OpenAI API.",
    configFields: [
      {
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://api.example.com/v1",
        required: true,
      },
    ],
    credentialFields: [
      {
        key: "apiKey",
        label: "API key",
        placeholder: "sk-…",
        help: "Leave empty for local servers without auth.",
      },
    ],
    canDiscoverModels: true,
  },
  azure_openai: {
    type: "azure_openai",
    label: "Azure OpenAI",
    description:
      "Azure OpenAI / AI Foundry deployments. Add each deployment name as a model.",
    configFields: [
      {
        key: "baseUrl",
        label: "Resource endpoint",
        placeholder: "https://my-resource.openai.azure.com",
        required: true,
      },
      {
        key: "apiVersion",
        label: "API version",
        placeholder: "Leave empty for the v1 API",
        help: "Only needed for the legacy deployments API, e.g. 2024-10-21.",
      },
    ],
    credentialFields: [{ key: "apiKey", label: "API key", required: true }],
    canDiscoverModels: false,
    metadataPrefix: "azure",
  },
  anthropic: {
    type: "anthropic",
    label: "Anthropic",
    description: "Claude models via the Anthropic API.",
    configFields: [
      {
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://api.anthropic.com/v1",
      },
    ],
    credentialFields: [
      {
        key: "apiKey",
        label: "API key",
        placeholder: "sk-ant-…",
        required: true,
      },
    ],
    canDiscoverModels: true,
    metadataPrefix: "anthropic",
  },
  bedrock: {
    type: "bedrock",
    label: "AWS Bedrock",
    description:
      "Models on Amazon Bedrock. Use model ids or inference profile ids (us.anthropic.…).",
    configFields: [
      {
        key: "region",
        label: "Region",
        placeholder: "us-east-1",
        required: true,
      },
    ],
    credentialFields: [
      {
        key: "apiKey",
        label: "Bedrock API key",
        help: "Either a Bedrock API key, or an access key pair below.",
      },
      { key: "accessKeyId", label: "Access key ID", placeholder: "AKIA…" },
      { key: "secretAccessKey", label: "Secret access key" },
      { key: "sessionToken", label: "Session token", help: "Optional." },
    ],
    canDiscoverModels: false,
    metadataPrefix: "bedrock",
  },
  vertex: {
    type: "vertex",
    label: "Google Vertex AI",
    description:
      "Gemini and Claude on Vertex AI. Model ids starting with claude- use the Anthropic endpoint.",
    configFields: [
      { key: "project", label: "Project ID", required: true },
      {
        key: "location",
        label: "Location",
        placeholder: "us-central1 or global",
        required: true,
      },
    ],
    credentialFields: [
      {
        key: "serviceAccountJson",
        label: "Service account JSON",
        multiline: true,
        required: true,
        help: "Paste the full JSON key file. It is encrypted before storage.",
      },
    ],
    canDiscoverModels: false,
    metadataPrefix: "vertex_ai",
  },
  google: {
    type: "google",
    label: "Google AI Studio (Gemini)",
    description: "Gemini models with an AI Studio API key, via the native API.",
    configFields: [],
    credentialFields: [{ key: "apiKey", label: "API key", required: true }],
    canDiscoverModels: true,
    metadataPrefix: "gemini",
  },
}

export interface ProviderPreset {
  id: string
  label: string
  type: ProviderType
  baseUrl?: string
  metadataPrefix?: string
  /** Where to create an API key. */
  keysUrl?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    type: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    metadataPrefix: "",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    label: "Groq",
    type: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    metadataPrefix: "groq",
    keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    type: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    metadataPrefix: "openrouter",
    keysUrl: "https://openrouter.ai/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    type: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    metadataPrefix: "deepseek",
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    label: "Mistral",
    type: "openai_compatible",
    baseUrl: "https://api.mistral.ai/v1",
    metadataPrefix: "mistral",
    keysUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "together",
    label: "Together AI",
    type: "openai_compatible",
    baseUrl: "https://api.together.xyz/v1",
    metadataPrefix: "together_ai",
    keysUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    type: "openai_compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    metadataPrefix: "fireworks_ai",
    keysUrl: "https://fireworks.ai/account/api-keys",
  },
  {
    id: "xai",
    label: "xAI",
    type: "openai_compatible",
    baseUrl: "https://api.x.ai/v1",
    metadataPrefix: "xai",
    keysUrl: "https://console.x.ai",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    type: "openai_compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    metadataPrefix: "cerebras",
    keysUrl: "https://cloud.cerebras.ai",
  },
  {
    id: "gemini-openai",
    label: "Gemini (OpenAI-compatible)",
    type: "openai_compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    metadataPrefix: "gemini",
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    type: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    type: "openai_compatible",
    baseUrl: "http://localhost:1234/v1",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    type: "openai_compatible",
  },
  { id: "azure", label: "Azure OpenAI", type: "azure_openai" },
  {
    id: "anthropic",
    label: "Anthropic",
    type: "anthropic",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  { id: "bedrock", label: "AWS Bedrock", type: "bedrock" },
  { id: "vertex", label: "Google Vertex AI", type: "vertex" },
  {
    id: "google",
    label: "Google AI Studio (native)",
    type: "google",
    keysUrl: "https://aistudio.google.com/apikey",
  },
]

export function findPreset(id: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}
