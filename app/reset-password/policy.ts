import "server-only"

import type { SessionState } from "@/lib/auth"

const RESET_WINDOW_S = 15 * 60
const LINK_METHODS = new Set(["recovery", "otp", "magiclink"])

/**
 * A password can only be reset from a session opened by an emailed reset
 * link in the last 15 minutes. (Signed-in people change it from Account &
 * security, which asks for the current password.)
 */
export function canResetPassword(state: SessionState): boolean {
  if (!("member" in state)) return false
  const now = Date.now() / 1000
  return state.member.authMethods.some(
    (entry) =>
      LINK_METHODS.has(entry.method) && now - entry.timestamp < RESET_WINDOW_S
  )
}
