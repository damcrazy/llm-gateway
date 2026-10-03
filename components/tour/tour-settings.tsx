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

/** Account page controls: tours on first visit (off by default), replay all. */
export function TourSettings() {
  const { autoStart, setAutoStart, resetSeen } = useTours()
  return (
    <div className="grid gap-4">
      <Field orientation="horizontal" data-tour="tour-auto">
        <FieldContent>
          <FieldLabel htmlFor="tour-auto">Start tours automatically</FieldLabel>
          <FieldDescription>
            Off by default: a page&apos;s tour only starts when you click the
            compass button at the top right. Turn this on to have each
            page&apos;s tour start the first time you open it.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="tour-auto"
          checked={autoStart}
          onCheckedChange={setAutoStart}
        />
      </Field>
      {autoStart && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetSeen()
              toast.success("Tours will start again as you open each page")
            }}
          >
            <RotateCcwIcon />
            Show all tours again
          </Button>
        </div>
      )}
    </div>
  )
}
