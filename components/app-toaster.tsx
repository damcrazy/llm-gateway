"use client"

import { useEffect, useRef, useState } from "react"
import { XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { toast, useSonner } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Toaster } from "@/components/ui/sonner"

// Room above the stack for the "Clear all" pill.
const OFFSET = { top: 60, right: 16 }
const MOBILE_OFFSET = { top: 60, right: 16, left: 16 }
// Lets the pointer cross the gap between the toasts and the pill.
const HIDE_DELAY_MS = 400

/**
 * Toasts in the top-right corner, each with a close button. Hovering a stack
 * of two or more reveals "Clear all", like macOS Notification Center.
 */
export function AppToaster() {
  const { toasts } = useSonner()
  const [hovered, setHovered] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  function enter() {
    clearTimeout(hideTimer.current)
    setHovered(true)
  }

  function leave() {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHovered(false), HIDE_DELAY_MS)
  }

  function clearAll() {
    clearTimeout(hideTimer.current)
    setHovered(false)
    toast.dismiss()
  }

  const showClearAll = hovered && toasts.length > 1

  return (
    <div onMouseEnter={enter} onMouseLeave={leave}>
      <AnimatePresence>
        {showClearAll && (
          <motion.div
            className="fixed top-4 right-4 z-[1000000000]"
            initial={{ opacity: 0, y: -6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full border shadow-md"
              onClick={clearAll}
            >
              <XIcon />
              Clear all
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster
        position="top-right"
        closeButton
        richColors
        offset={OFFSET}
        mobileOffset={MOBILE_OFFSET}
      />
    </div>
  )
}
