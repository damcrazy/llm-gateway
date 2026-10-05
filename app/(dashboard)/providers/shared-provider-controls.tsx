"use client"

import { useId, useOptimistic, useState, useTransition } from "react"
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
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

import {
  leaveSharedProvider,
  setProviderSwitchedOff,
  setProviderVisibility,
} from "./sharing-actions"

/** "Use in my apps": switches a provider off (or on) for your apps only. */
export function UseInMyAppsSwitch({
  providerId,
  name,
  on,
}: {
  providerId: string
  name: string
  on: boolean
}) {
  const [optimistic, setOptimistic] = useOptimistic(on)
  const [pending, startTransition] = useTransition()
  return (
    <Switch
      checked={optimistic}
      disabled={pending}
      aria-label={`Use ${name} in my apps`}
      onCheckedChange={(checked) =>
        startTransition(async () => {
          setOptimistic(checked)
          const result = await setProviderSwitchedOff(providerId, !checked)
          if (result.ok) toast.success(result.message)
          else toast.error(result.error)
        })
      }
    />
  )
}

export function LeaveProviderButton({
  providerId,
  name,
  owner,
}: {
  providerId: string
  name: string
  owner: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          {pending && <Spinner />}
          Leave
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop using {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your apps stop using it within about 15 seconds, and buckets skip
            its models. To use it again, {owner} has to send you a new invite.
            If you only want a pause, switch it off instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await leaveSharedProvider(providerId)
                if (result.ok) toast.success(result.message)
                else toast.error(result.error)
              })
            }
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Admins: "Visible to members". Off makes the provider yours alone (plus
 * anyone you invite); on gives it to every member. Asks before changing.
 */
export function ProviderVisibilitySwitch({
  providerId,
  name,
  visible,
  showLabel = false,
}: {
  providerId: string
  name: string
  visible: boolean
  showLabel?: boolean
}) {
  const switchId = useId()
  const [optimistic, setOptimistic] = useOptimistic(visible)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Kept after closing so the dialog's text doesn't flip as it fades out.
  const [confirming, setConfirming] = useState(true)
  const [pending, startTransition] = useTransition()

  function apply(next: boolean) {
    setConfirmOpen(false)
    startTransition(async () => {
      setOptimistic(next)
      const result = await setProviderVisibility(providerId, next)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={optimistic}
          disabled={pending}
          aria-label={showLabel ? undefined : `${name} visible to members`}
          onCheckedChange={(checked) => {
            setConfirming(checked)
            setConfirmOpen(true)
          }}
        />
        {showLabel && (
          <Label htmlFor={switchId}>
            {optimistic ? "Visible to members" : "Only you"}
          </Label>
        )}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming
                ? `Make ${name} available to every member?`
                : `Hide ${name} from members?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? "Every member can use its models again, within their model access. Invites and individual shares are removed, since everyone has it."
                : "Only your apps will be able to use it, plus anyone you invite from its page. Members' apps stop using its models within about 15 seconds: buckets and routes skip them, and calling one by name fails. Its settings and models are kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply(confirming)}>
              {confirming ? "Make it available" : "Hide from members"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
