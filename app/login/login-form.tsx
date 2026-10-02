"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createBrowserClient } from "@supabase/ssr"
import { InfoIcon, LogInIcon, ShieldAlertIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

import { finishSignIn } from "./actions"

type Message = { tone: "error" | "info"; text: string }

export function LoginForm({
  supabaseUrl,
  supabaseKey,
  googleEnabled,
  initialMessage,
}: {
  supabaseUrl: string
  supabaseKey: string
  googleEnabled: boolean
  initialMessage: Message | null
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState<Message | null>(initialMessage)
  const [pending, startTransition] = useTransition()
  const [redirecting, setRedirecting] = useState(false)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      // Sign in from the browser so Supabase's per-IP rate limits apply to
      // whoever is trying, not to this server. The session lands in cookies.
      const supabase = createBrowserClient(supabaseUrl, supabaseKey)
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) {
        setMessage({
          tone: "error",
          text:
            error.status === 429
              ? "Too many attempts. Wait a few minutes and try again."
              : "Incorrect email or password.",
        })
        return
      }
      const result = await finishSignIn()
      if (result && !result.ok)
        setMessage({ tone: "error", text: result.error })
    })
  }

  async function signInWithGoogle() {
    setMessage(null)
    setRedirecting(true)
    const supabase = createBrowserClient(supabaseUrl, supabaseKey)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    })
    if (error) {
      setRedirecting(false)
      setMessage({ tone: "error", text: error.message })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <Alert variant={message.tone === "error" ? "destructive" : "default"}>
          {message.tone === "error" ? <ShieldAlertIcon /> : <InfoIcon />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            hoverScale={1.02}
            disabled={redirecting || pending}
            onClick={signInWithGoogle}
          >
            {redirecting ? <Spinner /> : <GoogleIcon />}
            Continue with Google
          </Button>
          <FieldSeparator>or</FieldSeparator>
        </>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
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
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
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
          disabled={pending || redirecting}
        >
          {pending ? <Spinner /> : <LogInIcon />}
          Sign in
        </Button>
      </form>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}
