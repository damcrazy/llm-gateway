import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

import { describeNames, ENV_NAMES, readEnv } from "@/lib/env-names"

// Refreshes the Supabase session cookie and sends signed-out visitors to
// /login. This is only an optimistic check: the dashboard layout and every
// server action verify membership and two-factor again (see lib/auth.ts).
//
// The gateway API (/v1/*) is excluded so request bodies are never buffered
// here and API-key clients never see a redirect.

const PUBLIC_PATHS = ["/login", "/signup", "/auth/", "/forgot-password"]

/** Where to go back to once sign-in (and two-factor) is done. */
export const RETURN_COOKIE = "gw-return-to"
const RETURN_MAX_AGE_S = 15 * 60

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl = readEnv(ENV_NAMES.supabaseUrl)
  const supabaseKey = readEnv(ENV_NAMES.supabasePublishableKey)
  const missing = [
    ENV_NAMES.supabaseUrl,
    ENV_NAMES.supabasePublishableKey,
    ENV_NAMES.supabaseSecretKey,
    ENV_NAMES.encryptionKey,
  ]
    .filter((names) => !readEnv(names))
    .map(describeNames)
  if (!supabaseUrl || !supabaseKey || missing.length > 0) {
    return new NextResponse(
      `Gateway is not configured: missing ${missing.join(", ")}. Set ${missing.length > 1 ? "them" : "it"} in your environment (see .env.example) and redeploy.`,
      { status: 500 }
    )
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value)
        )
      },
    },
  })

  const { data } = await supabase.auth.getClaims()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((prefix) => path.startsWith(prefix))

  // A deep link (like an invite) opened before signing in, or before the
  // two-factor step, is remembered and reopened by /auth/continue.
  const remember =
    request.method === "GET" &&
    !isPublic &&
    path !== "/" &&
    !path.startsWith("/mfa") &&
    (!data?.claims || data.claims.aal !== "aal2")
  const setReturn = (res: NextResponse) => {
    if (!remember) return res
    res.cookies.set(RETURN_COOKIE, path + request.nextUrl.search, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: RETURN_MAX_AGE_S,
    })
    return res
  }

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return setReturn(NextResponse.redirect(url))
  }

  return setReturn(response)
}

export const config = {
  matcher: [
    "/((?!v1/|v1$|api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
