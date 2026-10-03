"use client"

import { CompassIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"

import { useTours } from "./tour-provider"

/** Header button that replays the tour for the page on screen. */
export function TourButton() {
  const { current, start } = useTours()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-tour="tour-button"
          aria-label={
            current ? `Tour: ${current.title}` : "No tour for this page"
          }
          disabled={!current}
          onClick={() => start()}
        >
          <CompassIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {current ? `Take the tour: ${current.title}` : "No tour for this page"}
      </TooltipContent>
    </Tooltip>
  )
}
