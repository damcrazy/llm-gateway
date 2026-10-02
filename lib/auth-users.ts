import "server-only"

import type { User } from "@supabase/supabase-js"

import { supabaseAdmin } from "@/lib/supabase/admin"

/** Finds an auth user by email (small user base, so a paged scan is fine). */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const target = email.toLowerCase()
  const db = supabaseAdmin()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 100,
    })
    if (error) throw new Error(error.message)
    const user = data.users.find((u) => u.email?.toLowerCase() === target)
    if (user) return user
    if (data.users.length < 100) break
  }
  return null
}

/** Creates a confirmed email/password account, or resets the password if it exists. */
export async function upsertPasswordUser(
  email: string,
  password: string
): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!error) return

  const existing = await findAuthUserByEmail(email)
  if (!existing) throw new Error(error.message)
  const { error: updateError } = await db.auth.admin.updateUserById(
    existing.id,
    {
      password,
      email_confirm: true,
    }
  )
  if (updateError) throw new Error(updateError.message)
}

/** Creates a confirmed account with no password (they sign in with Google). */
export async function ensureUser(email: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (!error) return
  if (await findAuthUserByEmail(email)) return
  throw new Error(error.message)
}
