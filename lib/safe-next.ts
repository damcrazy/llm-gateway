/** Only same-site paths are allowed as post-auth redirect targets. */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (!value || !value.startsWith("/")) return fallback
  // "//evil.com" and "/\evil.com" are protocol-relative URLs to another host.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback
  return value
}
