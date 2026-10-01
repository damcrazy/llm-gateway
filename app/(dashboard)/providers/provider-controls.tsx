"use client"

import { useId, useOptimistic, useTransition } from "react"
import { toast } from "sonner"

import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Label } from "@/components/ui/label"

import { setProviderEnabled } from "./actions"

export function ProviderEnabledSwitch({
  id,
  name,
  enabled,
  showLabel = false,
}: {
  id: string
  name: string
  enabled: boolean
  showLabel?: boolean
}) {
  const switchId = useId()
  const [optimistic, setOptimistic] = useOptimistic(enabled)
  const [pending, startTransition] = useTransition()

  const control = (
    <Switch
      id={switchId}
      checked={optimistic}
      disabled={pending}
      aria-label={
        showLabel ? undefined : `${optimistic ? "Disable" : "Enable"} ${name}`
      }
      onCheckedChange={(checked) =>
        startTransition(async () => {
          setOptimistic(checked)
          const result = await setProviderEnabled(id, checked)
          if (result.ok) toast.success(result.message)
          else toast.error(result.error)
        })
      }
    />
  )

  if (!showLabel) return control
  return (
    <div className="flex items-center gap-2">
      {control}
      <Label htmlFor={switchId}>{optimistic ? "Enabled" : "Disabled"}</Label>
    </div>
  )
}
