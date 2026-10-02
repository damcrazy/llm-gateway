"use client"

import { useState, useTransition } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { MailCheckIcon, SendIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function ForgotPasswordForm({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string
  supabaseKey: string
}) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const supabase = createBrowserClient(supabaseUrl, supabaseKey)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        }
      )
      // Same message whether or not the account exists (no account probing);
      // only rate limiting is worth surfacing.
      if (resetError?.status === 429) {
        setError("Too many requests. Wait a few minutes and try again.")
        return
      }
      setSent(true)
    })
  }

  if (sent) {
    return (
      <Alert>
        <MailCheckIcon />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          If {email.trim()} has an account, a reset link is on its way. It
          expires in an hour.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : <SendIcon />}
        Send reset link
      </Button>
    </form>
  )
}
