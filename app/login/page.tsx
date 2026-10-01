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
import { getSessionMember } from "@/lib/auth"
import { env } from "@/lib/env"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in" }

const ERRORS: Record<string, string> = {
  forbidden: "This account is not allowed to use the gateway dashboard.",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSessionMember()) redirect("/")
  const { error } = await searchParams

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
            initialError={error ? (ERRORS[error] ?? null) : null}
          />
        </CardContent>
        <CardFooter className="justify-center text-xs text-muted-foreground">
          Accounts are created by the gateway owner.
        </CardFooter>
      </Card>
    </main>
  )
}
