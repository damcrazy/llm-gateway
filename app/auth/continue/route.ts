import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

import { safeNextPath } from "@/lib/safe-next"

const RETURN_COOKIE = "gw-return-to"

/**
 * Where sign-in ends: reopens the page someone was trying to reach before
 * signing in (an invite link, say), once, or the overview. Only same-site
 * paths are followed; the page itself checks access as usual.
 */
export async function GET(request: NextRequest) {
  const store = await cookies()
  const target = safeNextPath(store.get(RETURN_COOKIE)?.value)
  const response = NextResponse.redirect(new URL(target, request.url))
  response.cookies.delete(RETURN_COOKIE)
  return response
}
