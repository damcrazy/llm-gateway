// Guided tours (driver.js). A page declares its tour with <PageTour id="…" />
// and marks elements with data-tour="…"; each step points at one of them.

export interface TourStep {
  /** The data-tour value of the element to highlight; omit for a centred step. */
  target?: string
  title: string
  /**
   * What this part is, what it does and why it matters, in a few plain
   * sentences. May use <b>, <code>, <em> and <br>.
   */
  body: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}

export interface TourDefinition {
  id: string
  /** Bump to show the tour again to people who've seen an older version. */
  version: number
  /** Shown in the header button's tooltip. */
  title: string
  steps: TourStep[]
}
