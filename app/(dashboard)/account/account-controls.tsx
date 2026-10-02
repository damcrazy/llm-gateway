"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react"
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
import { TotpEnroll } from "@/components/totp-enroll"

import { removeAuthenticator } from "./actions"

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
