// Shared by the browser (forms) and the server (validation).

export const MIN_PASSWORD_LENGTH = 12

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password.length > 72) return "Use at most 72 characters"
  return null
}

/** 24 random URL-safe characters, for one-time starting passwords. */
export function generatePassword(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}
