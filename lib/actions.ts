/** Return shape for every dashboard server action. */
export type ActionResult<T = undefined> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string }

export function actionError(error: unknown): { ok: false; error: string } {
  if (error instanceof Error) return { ok: false, error: error.message }
  if (typeof error === "object" && error && "message" in error) {
    return { ok: false, error: String((error as { message: unknown }).message) }
  }
  return { ok: false, error: "Something went wrong" }
}

/** "My App!" -> "my-app" */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}
