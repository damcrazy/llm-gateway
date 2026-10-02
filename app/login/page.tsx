import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { WaypointsIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSessionState, pathForState } from "@/lib/auth"
import { getAuthSettings } from "@/lib/auth-settings"
import { env } from "@/lib/env"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in" }

const MESSAGES: Record<string, { tone: "error" | "info"; text: string }> = {
  forbidden: {
    tone: "error",
    text: "This account is not allowed to use the gateway dashboard. Ask the owner to add you.",
  },
  oauth: {
    tone: "error",
    text: "Google sign-in didn't complete. Please try again.",
  },
  link: {
    tone: "error",
    text: "That link is invalid or has expired. Request a new one.",
  },
  "password-reset": {
    tone: "info",
    text: "Password updated. Sign in with your new password.",
  },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const state = await getSessionState()
  if (state.status !== "signed_out" && state.status !== "not_member") {
    redirect(pathForState(state))
  }
  const [{ error }, settings] = await Promise.all([
    searchParams,
    getAuthSettings(),
  ])

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <WaypointsIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">LLM Gateway</CardTitle>
          <CardDescription>Sign in to manage your gateway.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* The URL and publishable key are public by design; RLS protects the data. */}
          <LoginForm
            supabaseUrl={env.supabaseUrl()}
            supabaseKey={env.supabasePublishableKey()}
            googleEnabled={settings.google}
            initialMessage={error ? (MESSAGES[error] ?? null) : null}
          />
        </CardContent>
        <CardFooter className="justify-center text-xs text-muted-foreground">
          Accounts are created by the gateway owner.
        </CardFooter>
      </Card>
    </main>
  )
}
