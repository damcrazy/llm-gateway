import { NextResponse, type NextRequest } from "next/server"

import { getOrigin } from "@/lib/auth"
import { env } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const origin = await getOrigin()
  const params = request.nextUrl.searchParams
  const code = params.get("code")

  // The before-user-created hook rejects unknown emails before an account exists.
  if (params.get("error") || !code) {
    return NextResponse.redirect(`${origin}/login?error=forbidden`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const email = data.user.email?.toLowerCase() ?? ""
  const { data: admin } = await supabaseAdmin()
    .from("members")
    .select("email")
    .eq("email", email)
    .maybeSingle()

  if (!admin && email !== env.superadminEmail()) {
    // Belt and braces in case the auth hook is not enabled: remove the account.
    await supabase.auth.signOut()
    await supabaseAdmin().auth.admin.deleteUser(data.user.id)
    return NextResponse.redirect(`${origin}/login?error=forbidden`)
  }

  return NextResponse.redirect(`${origin}/`)
}
