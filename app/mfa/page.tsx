import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getSessionState, pathForState } from "@/lib/auth"
import { env } from "@/lib/env"

import { ChallengeClient } from "./challenge-client"
import { MfaShell } from "./mfa-shell"

export const metadata: Metadata = { title: "Two-factor authentication" }

export default async function MfaChallengePage() {
  const state = await getSessionState()
  if (state.status !== "mfa_challenge") redirect(pathForState(state))

  return (
    <MfaShell
      title="Two-factor authentication"
      description={`Enter the 6-digit code from your authenticator app for ${state.member.email}.`}
    >
      <ChallengeClient
        email={state.member.email}
        supabaseUrl={env.supabaseUrl()}
        supabaseKey={env.supabasePublishableKey()}
      />
    </MfaShell>
  )
}
