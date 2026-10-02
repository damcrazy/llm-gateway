"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createBrowserClient } from "@supabase/ssr"
import { InfoIcon, MailCheckIcon, UserPlusIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { GoogleSignInButton } from "@/components/google-sign-in-button"
import { PasswordInput } from "@/components/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password"

export function SignupForm({
  supabaseUrl,
  supabaseKey,
  googleEnabled,
}: {
  supabaseUrl: string
  supabaseKey: string
  googleEnabled: boolean
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [existing, setExisting] = useState(false)
  const [pending, startTransition] = useTransition()
  const mismatch = confirm !== "" && confirm !== password

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (mismatch) return
    setError(null)
    startTransition(async () => {
      const supabase = createBrowserClient(supabaseUrl, supabaseKey)
      const address = email.trim()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      // One account per email: Supabase refuses a second one (or, depending
      // on settings, answers with an empty identity list). Nothing changes on
      // the existing account, including its password.
      if (
        signUpError?.code === "user_already_exists" ||
        (!signUpError && data.user?.identities?.length === 0)
      ) {
        setExisting(true)
        return
      }
      if (signUpError) {
        setError(
          signUpError.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : signUpError.message
        )
        return
      }
      setSentTo(address)
    })
  }

  if (sentTo) {
    return (
      <Alert>
        <MailCheckIcon />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          <p>
            We sent a confirmation link to {sentTo}. Open it to finish creating
            your account.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  if (existing) {
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>This email already has an account</AlertTitle>
        <AlertDescription>
          <p>
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>{" "}
            with it instead. If you signed up with Google and want a password
            too, use{" "}
            <Link
              href="/forgot-password"
              className="underline underline-offset-4"
            >
              Forgot password
            </Link>
            : it adds one to the same account.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {googleEnabled && (
        <>
          <GoogleSignInButton
            supabaseUrl={supabaseUrl}
            supabaseKey={supabaseKey}
            disabled={pending}
            onError={setError}
          />
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
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">Password</FieldLabel>
            <PasswordInput
              id="new-password"
              value={password}
              onChange={setPassword}
            />
            <FieldDescription>
              At least {MIN_PASSWORD_LENGTH} characters.
            </FieldDescription>
          </Field>
          <Field data-invalid={mismatch || undefined}>
            <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              value={confirm}
              onChange={setConfirm}
            />
            {mismatch && <FieldError>Passwords don&apos;t match</FieldError>}
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          className="w-full"
          hoverScale={1.02}
          disabled={pending || mismatch}
        >
          {pending ? <Spinner /> : <UserPlusIcon />}
          Create account
        </Button>
      </form>
    </div>
  )
}
