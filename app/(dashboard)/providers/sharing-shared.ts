export const INVITE_DAYS = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
] as const

export const MAX_PENDING_INVITES = 20

export interface ShareView {
  email: string
  since: string
  /** This month (UTC), through this provider. */
  requests: number
  costUsd: number
}

export interface InviteView {
  id: string
  /** null: anyone with the link and the code. */
  email: string | null
  expiresAt: string
  createdAt: string
  attemptsLeft: number
}
