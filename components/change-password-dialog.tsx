"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog"
import { PasswordInput } from "@/components/password-input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password"
import { changePassword } from "@/app/login/actions"

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [pending, startTransition] = useTransition()

  const mismatch = confirm !== "" && confirm !== next

  function handleOpenChange(value: boolean) {
    if (value) {
      setCurrent("")
      setNext("")
      setConfirm("")
    }
    onOpenChange(value)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(next)
    if (problem) {
      toast.error(problem)
      return
    }
    if (mismatch) return
    startTransition(async () => {
      const result = await changePassword(current, next)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Use a password manager to generate and store a long password.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                value={current}
                onChange={setCurrent}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                value={next}
                onChange={setNext}
              />
              <FieldDescription>
                At least {MIN_PASSWORD_LENGTH} characters.
              </FieldDescription>
            </Field>
            <Field data-invalid={mismatch || undefined}>
              <FieldLabel htmlFor="confirm-password">
                Confirm new password
              </FieldLabel>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={setConfirm}
              />
              {mismatch && <FieldError>Passwords don&apos;t match</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || mismatch}>
              {pending && <Spinner />}
              Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
