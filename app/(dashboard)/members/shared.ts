import type { MemberRole, ModelAccess } from "@/lib/db/types"

export const MODEL_ACCESS_OPTIONS: {
  value: ModelAccess
  label: string
  description: string
}[] = [
  {
    value: "free",
    label: "Free models only",
    description:
      "Only models priced at $0. Paid and unknown-price models are blocked.",
  },
  {
    value: "allowlist",
    label: "Selected routes and models",
    description: "Only the routes and models you pick below.",
  },
  {
    value: "all",
    label: "All models",
    description: "Every enabled route and model, including paid ones.",
  },
]

export interface MemberAccessInput {
  role: Exclude<MemberRole, "superadmin">
  model_access: ModelAccess
  allowed_models: string[]
  monthly_budget_usd: number | null
}

export const DEFAULT_MEMBER_ACCESS: MemberAccessInput = {
  role: "member",
  model_access: "free",
  allowed_models: [],
  monthly_budget_usd: null,
}

export function accessSummary(
  role: MemberRole,
  access: ModelAccess,
  allowed: string[]
): string {
  if (role !== "member") return "Everything"
  if (access === "free") return "Free models only"
  if (access === "allowlist")
    return `${allowed.length} route${allowed.length === 1 ? "" : "s"}/model${allowed.length === 1 ? "" : "s"}`
  return "All models"
}
