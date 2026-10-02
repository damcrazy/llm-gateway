import { describe, expect, test } from "bun:test"

import { canResetPassword } from "@/app/reset-password/policy"
import type { SessionMember, SessionState } from "@/lib/auth"
import { safeNextPath } from "@/lib/safe-next"

describe("safeNextPath", () => {
  test("keeps same-site paths", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password")
    expect(safeNextPath("/apps?tab=keys")).toBe("/apps?tab=keys")
  })

  test("rejects other hosts and junk", () => {
    expect(safeNextPath("https://evil.example")).toBe("/")
    expect(safeNextPath("//evil.example")).toBe("/")
    expect(safeNextPath("/\\evil.example")).toBe("/")
    expect(safeNextPath("reset-password")).toBe("/")
    expect(safeNextPath(null)).toBe("/")
    expect(safeNextPath(undefined, "/login")).toBe("/login")
  })
})

function state(
  status: "ok" | "mfa_setup" | "mfa_challenge",
  methods: [string, number][]
): SessionState {
  const now = Date.now() / 1000
  const member = {
    authMethods: methods.map(([method, ageSeconds]) => ({
      method,
      timestamp: now - ageSeconds,
    })),
  } as SessionMember
  return { status, member }
}

describe("canResetPassword", () => {
  test("allowed right after an emailed reset link", () => {
    expect(canResetPassword(state("mfa_challenge", [["recovery", 60]]))).toBe(
      true
    )
    expect(canResetPassword(state("mfa_setup", [["otp", 60]]))).toBe(true)
  })

  test("the link session expires after 15 minutes", () => {
    expect(
      canResetPassword(state("mfa_challenge", [["recovery", 16 * 60]]))
    ).toBe(false)
  })

  test("a signed-in session can't skip the current password", () => {
    expect(
      canResetPassword(
        state("ok", [
          ["password", 60],
          ["totp", 30],
        ])
      )
    ).toBe(false)
    expect(canResetPassword(state("mfa_challenge", [["oauth", 60]]))).toBe(
      false
    )
  })

  test("signed out or not a member", () => {
    expect(canResetPassword({ status: "signed_out" })).toBe(false)
    expect(canResetPassword({ status: "not_member" })).toBe(false)
  })
})
