"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { PasswordInput } from "@/components/password-input"
import { TotpEnroll } from "@/components/totp-enroll"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password"

import { removeAuthenticator, setPassword } from "./actions"

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRoundIcon />
        Change password
      </Button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** For Google-only accounts: add a password to the same account. */
export function SetPasswordButton() {
  const [open, setOpen] = useState(false)
  const [password, setPasswordValue] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const mismatch = confirm !== "" && confirm !== password

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setPasswordValue("")
      setConfirm("")
      setError(null)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (mismatch) return
    startTransition(async () => {
      const result = await setPassword(password)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRoundIcon />
          Set a password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Set a password</DialogTitle>
            <DialogDescription>
              Then you can sign in with your email and this password as well as
              with Google. It&apos;s the same account either way.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="set-password">New password</FieldLabel>
              <PasswordInput
                id="set-password"
                value={password}
                onChange={setPasswordValue}
              />
              <FieldDescription>
                At least {MIN_PASSWORD_LENGTH} characters.
              </FieldDescription>
            </Field>
            <Field data-invalid={mismatch || undefined}>
              <FieldLabel htmlFor="set-password-confirm">
                Confirm password
              </FieldLabel>
              <PasswordInput
                id="set-password-confirm"
                value={confirm}
                onChange={setConfirm}
              />
              {mismatch && <FieldError>Passwords don&apos;t match</FieldError>}
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || mismatch}>
              {pending ? <Spinner /> : <CheckIcon />}
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function nextName(existing: string[]): string {
  const taken = new Set(existing)
  for (let n = 2; n < 50; n++) {
    const name = `Backup authenticator ${n - 1}`
    if (!taken.has(name)) return name
  }
  return `Authenticator ${Date.now()}`
}

export function AddAuthenticatorButton({
  supabaseUrl,
  supabaseKey,
  existingNames,
}: {
  supabaseUrl: string
  supabaseKey: string
  existingNames: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlusIcon />
          Add authenticator
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add an authenticator</DialogTitle>
          <DialogDescription>
            Use a second phone or a password manager as a backup, so losing one
            device doesn&apos;t lock you out.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TotpEnroll
            supabaseUrl={supabaseUrl}
            supabaseKey={supabaseKey}
            friendlyName={nextName(existingNames)}
            onEnrolled={() => {
              toast.success("Authenticator added")
              setOpen(false)
              router.refresh()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RemoveAuthenticatorButton({
  factorId,
  name,
  isLast,
}: {
  factorId: string
  name: string
  isLast: boolean
}) {
  const [pending, startTransition] = useTransition()

  if (isLast) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              aria-label={`Remove ${name}`}
            >
              <Trash2Icon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Add another authenticator before removing this one
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Codes from this device will stop working. Your other authenticators
            keep working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await removeAuthenticator(factorId)
                if (result.ok) toast.success(result.message)
                else toast.error(result.error)
              })
            }
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
