import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

import { getOrigin } from "@/lib/auth"
import { keepOnlyMembers } from "@/lib/auth-session"
import { safeNextPath } from "@/lib/safe-next"
import { createClient } from "@/lib/supabase/server"

// Only password-reset links; magic-link sign-in isn't offered.
const ALLOWED_TYPES = new Set<EmailOtpType>(["recovery"])

/**
 * Email links built from the templates in supabase/templates
 * ({{ .TokenHash }}). Unlike the default links these work when the email is
 * opened on a different device or browser.
 */
export async function GET(request: NextRequest) {
  const origin = await getOrigin()
  const params = request.nextUrl.searchParams
  const tokenHash = params.get("token_hash")
  const type = params.get("type") as EmailOtpType | null
  const next = safeNextPath(params.get("next"))

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(`${origin}/login?error=link`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  })
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=link`)
  }
  if (!(await keepOnlyMembers(data.user))) {
    return NextResponse.redirect(`${origin}/login?error=forbidden`)
  }
  return NextResponse.redirect(`${origin}${next}`)
}
