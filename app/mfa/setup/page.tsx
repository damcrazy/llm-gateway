import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getSessionState, pathForState } from "@/lib/auth"
import { env } from "@/lib/env"

import { MfaShell } from "../mfa-shell"
import { SetupClient } from "./setup-client"

export const metadata: Metadata = { title: "Set up two-factor authentication" }

export default async function MfaSetupPage() {
  const state = await getSessionState()
  if (state.status !== "mfa_setup") redirect(pathForState(state))

  return (
    <MfaShell
      title="Set up two-factor authentication"
      description={
        <>
          Required for every account on this gateway. Signed in as{" "}
          {state.member.email}.
        </>
      }
    >
      <SetupClient
        supabaseUrl={env.supabaseUrl()}
        supabaseKey={env.supabasePublishableKey()}
      />
    </MfaShell>
  )
}
