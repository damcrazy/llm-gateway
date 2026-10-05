import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { KeyRoundIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { env } from "@/lib/env"

import { ForgotPasswordForm } from "./forgot-password-form"

export const metadata: Metadata = { title: "Forgot password" }

export default async function ForgotPasswordPage() {
  // Settings are read per request, so builds (e.g. Docker) need no env.
  await connection()
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRoundIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription>
            We&apos;ll email you a link to choose a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm
            supabaseUrl={env.supabaseUrl()}
            supabaseKey={env.supabasePublishableKey()}
          />
        </CardContent>
        <CardFooter className="justify-center text-sm">
          <Link
            href="/login"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    </main>
  )
}
