"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { driver, type Driver } from "driver.js"
import "driver.js/dist/driver.css"

import { TOURS } from "./tours"
import type { TourDefinition } from "./types"

// Runs the guided tour for whatever is on screen. Pages (and tabs) declare
// theirs with <PageTour id="…" />; a page and its open tab play as one tour
// (page first). Tours start from the header's compass button; people who
// turn on "Start tours automatically" (Account) also get each one the
// first time they see it.
// (unless turned off in Account) and replay from the header. Steps whose
// element isn't on screen (admin-only parts, empty lists, a collapsed
// sidebar) are skipped.

interface TourContextValue {
  /** The tour for what's on screen, if there is one. */
  current: TourDefinition | null
  start: (id?: string) => void
  register: (id: string) => () => void
  autoStart: boolean
  setAutoStart: (on: boolean) => void
  /** Shows every tour again, as if never seen. */
  resetSeen: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

/** Tests can force automatic tours off for a whole browser. */
const GLOBAL_AUTO_KEY = "gw-tours-auto"
const START_DELAY_MS = 700
const WAIT_FOR_PAGE_MS = 5_000

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode or storage blocked: tours just show again next time.
  }
}

function isVisible(element: Element | null | undefined): element is Element {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  return getComputedStyle(element).visibility !== "hidden"
}

/** The first visible element for a target (tabs can briefly render twice). */
function findTarget(target: string): Element | null {
  const all = document.querySelectorAll(`[data-tour="${CSS.escape(target)}"]`)
  return [...all].find(isVisible) ?? null
}

function dialogOpen() {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    )
  )
}

export function TourProvider({
  userId,
  children,
}: {
  userId: string
  children: React.ReactNode
}) {
  const [scopes, setScopes] = useState<string[]>([])
  const [autoStart, setAutoStartState] = useState(false)
  const active = useRef<{ ids: string[]; driver: Driver } | null>(null)
  // Bumped when a tour ends, so the next unseen one can start.
  const [finished, setFinished] = useState(0)
  const prefix = `gw-tour:${userId}`

  useEffect(() => {
    // Read after mount: localStorage only exists in the browser.
    // Off unless the person turned it on in Account.
    const on =
      read(`${prefix}:auto`) === "on" && read(GLOBAL_AUTO_KEY) !== "off"
    const timer = setTimeout(() => setAutoStartState(on), 0)
    return () => clearTimeout(timer)
  }, [prefix])

  const register = useCallback((id: string) => {
    setScopes((current) => [...current, id])
    return () =>
      setScopes((current) => {
        const index = current.lastIndexOf(id)
        return index < 0
          ? current
          : [...current.slice(0, index), ...current.slice(index + 1)]
      })
  }, [])

  const stack = useMemo(
    () =>
      [...new Set(scopes)]
        .map((id) => TOURS[id])
        .filter((tour): tour is TourDefinition => Boolean(tour)),
    [scopes]
  )
  const current = stack.at(-1) ?? null

  const run = useCallback(
    (tours: TourDefinition[]) => {
      const steps = tours
        .flatMap((tour) => tour.steps)
        .filter((step) => !step.target || findTarget(step.target))
      if (!steps.length) return
      active.current?.driver.destroy()
      const instance = driver({
        steps: steps.map((step) => ({
          element: step.target
            ? () => findTarget(step.target!) as Element
            : undefined,
          popover: {
            title: step.title,
            description: step.body,
            side: step.side,
            align: step.align,
          },
        })),
        showProgress: steps.length > 1,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        popoverClass: "gw-tour",
        overlayColor: "#000",
        overlayOpacity: 0.6,
        stagePadding: 6,
        stageRadius: 10,
        smoothScroll: true,
        allowClose: true,
        onDestroyed: () => {
          // Seen once it's closed, finished or skipped.
          for (const tour of tours)
            write(`${prefix}:${tour.id}`, String(tour.version))
          if (active.current?.driver === instance) active.current = null
          setFinished((count) => count + 1)
        },
      })
      active.current = { ids: tours.map((tour) => tour.id), driver: instance }
      instance.drive()
    },
    [prefix]
  )

  // Start the tours on screen that haven't been seen yet.
  useEffect(() => {
    if (!autoStart) return
    const unseen = stack.filter(
      (tour) => read(`${prefix}:${tour.id}`) !== String(tour.version)
    )
    if (!unseen.length) return
    const begin = Date.now()
    const targets = unseen.flatMap((tour) =>
      tour.steps.flatMap((step) => (step.target ? [step.target] : []))
    )
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const waited = Date.now() - begin > WAIT_FOR_PAGE_MS
      const ready = !targets.length || targets.some((t) => findTarget(t))
      if (active.current || dialogOpen()) {
        if (!waited) timer = setTimeout(tick, 250)
        return
      }
      if (ready || waited) run(unseen)
      else timer = setTimeout(tick, 200)
    }
    timer = setTimeout(tick, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [stack, autoStart, prefix, run, finished])

  // Leaving the page (or tab) ends its tour.
  useEffect(() => {
    if (active.current?.ids.some((id) => !scopes.includes(id)))
      active.current.driver.destroy()
  }, [scopes])

  useEffect(() => () => active.current?.driver.destroy(), [])

  const value = useMemo<TourContextValue>(
    () => ({
      current,
      start: (id) => {
        const tours = id ? [TOURS[id]].filter(Boolean) : stack
        if (tours.length) run(tours as TourDefinition[])
      },
      register,
      autoStart,
      setAutoStart: (on) => {
        write(`${prefix}:auto`, on ? "on" : null)
        if (on) write(GLOBAL_AUTO_KEY, null)
        setAutoStartState(on)
      },
      resetSeen: () => {
        for (const id of Object.keys(TOURS)) write(`${prefix}:${id}`, null)
      },
    }),
    [current, stack, register, run, autoStart, prefix]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTours(): TourContextValue {
  const value = useContext(TourContext)
  if (!value) throw new Error("useTours must be used inside <TourProvider>")
  return value
}

/** Declares the tour for the page (or tab) it's rendered in. */
export function PageTour({ id }: { id: string }) {
  const { register } = useTours()
  useEffect(() => register(id), [id, register])
  return null
}
