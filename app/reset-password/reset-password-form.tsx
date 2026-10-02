"use client"

import { useState, useTransition } from "react"
import { CheckIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PasswordInput } from "@/components/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password"

import { completePasswordReset } from "./actions"

export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
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
      const result = await completePasswordReset(password)
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
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
      <Button type="submit" className="w-full" disabled={pending || mismatch}>
        {pending ? <Spinner /> : <CheckIcon />}
        Save password
      </Button>
    </form>
  )
}
