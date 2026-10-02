import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { UserPlusIcon } from "lucide-react"

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

import { SignupForm } from "./signup-form"

export const metadata: Metadata = { title: "Create an account" }

export default async function SignupPage() {
  const state = await getSessionState()
  if (state.status !== "signed_out" && state.status !== "not_member") {
    redirect(pathForState(state))
  }
  const settings = await getAuthSettings()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <UserPlusIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Create an account</CardTitle>
          <CardDescription>
            Create apps and API keys for free models. The owner can give you
            more.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm
            supabaseUrl={env.supabaseUrl()}
            supabaseKey={env.supabasePublishableKey()}
            googleEnabled={settings.google}
          />
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
          Already have an account?
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </main>
  )
}
