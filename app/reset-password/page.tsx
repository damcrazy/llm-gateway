import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { KeyRoundIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSessionState } from "@/lib/auth"

import { canResetPassword } from "./policy"
import { ResetPasswordForm } from "./reset-password-form"

export const metadata: Metadata = { title: "Choose a new password" }

export default async function ResetPasswordPage() {
  const state = await getSessionState()
  if (!canResetPassword(state)) redirect("/login?error=link")
  const email = "member" in state ? state.member.email : ""

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRoundIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>
            For {email}. You&apos;ll sign in again afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </main>
  )
}
