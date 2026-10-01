import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Refreshes the Supabase session cookie and sends signed-out visitors to
// /login. This is only an optimistic check: the dashboard layout and every
// server action verify admin access again (see lib/auth.ts).
//
// The gateway API (/v1/*) is excluded so request bodies are never buffered
// here and API-key clients never see a redirect.

const PUBLIC_PATHS = ["/login", "/auth/"]

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return new NextResponse(
      "Gateway is not configured: missing Supabase environment variables.",
      {
        status: 500,
      }
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

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!v1/|v1$|api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
