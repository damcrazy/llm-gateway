import type { TourDefinition } from "../types"
import { ACCOUNT_TOURS } from "./account"
import { APPS_TOURS } from "./apps"
import { CATALOG_TOURS } from "./catalog"
import { MONITOR_TOURS } from "./monitor"
import { OVERVIEW_TOURS } from "./overview"
import { STUDIO_TOURS } from "./studio"

export const TOURS: Record<string, TourDefinition> = Object.fromEntries(
  [
    ...OVERVIEW_TOURS,
    ...APPS_TOURS,
    ...ACCOUNT_TOURS,
    ...MONITOR_TOURS,
    ...CATALOG_TOURS,
    ...STUDIO_TOURS,
  ].map((tour) => [tour.id, tour])
)
