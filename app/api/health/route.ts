import { supabaseAdmin } from "@/lib/supabase/admin"

// Liveness for Docker / uptime checks. `?deep=1` also touches the database,
// which keeps a free-tier Supabase project from pausing (see vercel.json cron).
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.has("deep")
  if (!deep) return Response.json({ ok: true })

  const started = Date.now()
  const { error } = await supabaseAdmin()
    .from("routes")
    .select("id", { head: true, count: "exact" })
  return Response.json(
    {
      ok: !error,
      database: error ? "unreachable" : "ok",
      latency_ms: Date.now() - started,
    },
    { status: error ? 503 : 200 }
  )
}
