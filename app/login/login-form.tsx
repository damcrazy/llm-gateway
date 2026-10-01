"use client"

import { useState, useTransition } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { LogInIcon, ShieldAlertIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

import { finishSignIn } from "./actions"

export function LoginForm({
  supabaseUrl,
  supabaseKey,
  initialError,
}: {
  supabaseUrl: string
  supabaseKey: string
  initialError: string | null
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(initialError)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      // Sign in from the browser so Supabase's per-IP rate limits apply to
      // whoever is trying, not to this server. The session lands in cookies.
      const supabase = createBrowserClient(supabaseUrl, supabaseKey)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError(
          signInError.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : "Incorrect email or password."
        )
        return
      }
      const result = await finishSignIn()
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>Sign-in failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
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
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Button
        type="submit"
        className="w-full"
        hoverScale={1.02}
        disabled={pending}
      >
        {pending ? <Spinner /> : <LogInIcon />}
        Sign in
      </Button>
    </form>
  )
}
