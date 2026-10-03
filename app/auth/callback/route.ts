import { NextResponse, type NextRequest } from "next/server"

import { audit } from "@/lib/audit"
import { getOrigin } from "@/lib/auth"
import { keepOnlyMembers } from "@/lib/auth-session"
import { safeNextPath } from "@/lib/safe-next"
import { createClient } from "@/lib/supabase/server"

/**
 * OAuth (Google) and same-browser email links (PKCE) land here with a code.
 * With public sign-ups off, Supabase refuses Google sign-ins from anyone who
 * isn't already a member, and returns an error instead of a code.
 */
export async function GET(request: NextRequest) {
  const origin = await getOrigin()
  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const next = safeNextPath(params.get("next"))

  if (params.get("error") || !code) {
    const description = params.get("error_description") ?? ""
    const reason = /sign.?ups? not allowed|not allowed|access_denied/i.test(
      description + (params.get("error") ?? "")
    )
      ? "forbidden"
      : "oauth"
    return NextResponse.redirect(`${origin}/login?error=${reason}`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=link`)
  }
  if (!(await keepOnlyMembers(data.user))) {
    return NextResponse.redirect(`${origin}/login?error=forbidden`)
  }
  if (data.user.email) {
    // The newest sign-in method on this session: "oauth" for Google.
    const { data: claims } = await supabase.auth.getClaims()
    const amr = Array.isArray(claims?.claims.amr)
      ? (claims.claims.amr as { method?: string; timestamp?: number }[])
      : []
    const method =
      [...amr].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0]
        ?.method ?? "unknown"
    await audit(
      data.user.email,
      "account.sign_in",
      method === "oauth"
        ? "Signed in with Google"
        : "Signed in with an email link",
      { type: "account", id: data.user.id, name: data.user.email },
      { method: method === "oauth" ? "google" : method }
    )
  }

  // The dashboard layout sends people on to 2FA setup or the 2FA challenge.
  return NextResponse.redirect(`${origin}${next}`)
}
