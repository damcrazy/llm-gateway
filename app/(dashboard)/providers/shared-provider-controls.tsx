"use client"

import { useOptimistic, useTransition } from "react"
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
import { Spinner } from "@/components/ui/spinner"

import { leaveSharedProvider, setProviderSwitchedOff } from "./sharing-actions"

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
