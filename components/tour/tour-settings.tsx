"use client"

import { RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"

import { useTours } from "./tour-provider"

/** Account page controls: automatic tours on or off, and replay all. */
export function TourSettings() {
  const { autoStart, setAutoStart, resetSeen } = useTours()
  return (
    <div className="grid gap-4">
      <Field orientation="horizontal" data-tour="tour-auto">
        <FieldContent>
          <FieldLabel htmlFor="tour-auto">
            Show page tours automatically
          </FieldLabel>
          <FieldDescription>
            The first time you open a page, a short tour points out what each
            part does. You can always replay it with the compass button at the
            top right.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="tour-auto"
          checked={autoStart}
          onCheckedChange={setAutoStart}
        />
      </Field>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetSeen()
            setAutoStart(true)
            toast.success("Tours will show again as you open each page")
          }}
        >
          <RotateCcwIcon />
          Show all tours again
        </Button>
      </div>
    </div>
  )
}
