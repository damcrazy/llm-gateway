import "server-only"

import { lookup, type LookupAddress } from "node:dns"
import { isIP } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"

import { hostOf, isPublicAddress } from "./public-address"

// fetch for member-owned providers: https only, and every connection must
// go to a public address. The check runs on the addresses DNS returns at
// connect time (not just when the URL was saved), so a hostname can't be
// pointed at an internal address later (DNS rebinding), and redirects are
// refused.

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedAddressError"
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void

function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback
) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, [])
    const list = addresses as LookupAddress[]
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(
        Object.assign(
          new BlockedAddressError(
            `${hostname} resolves to a private network address, which your own providers can't use`
          ),
          { code: "EPRIVATEADDR" }
        ),
        []
      )
    }
    if (options.all) callback(null, list)
    else callback(null, list[0]!.address, list[0]!.family)
  })
}

const agent = new Agent({
  connect: { lookup: publicOnlyLookup as never },
})

/** Why a URL can't be used by a member-owned provider, or null if it can. */
export function publicUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "Enter a full URL, like https://api.example.com/v1"
  }
  if (url.protocol !== "https:")
    return "Your own providers must use an https:// URL"
  if (url.username || url.password)
    return "Put credentials in the credentials fields, not in the URL"
  const host = hostOf(url)
  if (isIP(host) && !isPublicAddress(host))
    return `${host} is a private network address, which your own providers can't use`
  if (host === "localhost" || host.endsWith(".localhost"))
    return "localhost isn't reachable for your own providers"
  return null
}

/** Resolves the host now, for a friendly error when a provider is saved. */
export async function checkPublicUrl(raw: string): Promise<string | null> {
  const problem = publicUrlProblem(raw)
  if (problem) return problem
  const host = hostOf(new URL(raw))
  if (isIP(host)) return null
  return new Promise((resolve) => {
    publicOnlyLookup(host, { all: true }, (error) => {
      if (!error) return resolve(null)
      resolve(
        error instanceof BlockedAddressError
          ? error.message
          : `Couldn't find ${host}. Check the URL.`
      )
    })
  })
}

/** The address refusal inside undici's wrapped errors, if that's the cause. */
function findBlocked(error: unknown, depth = 0): Error | null {
  if (!(error instanceof Error) || depth > 4) return null
  if ((error as { code?: string }).code === "EPRIVATEADDR") return error
  const nested = [
    (error as { cause?: unknown }).cause,
    ...((error as { errors?: unknown[] }).errors ?? []),
  ]
  for (const inner of nested) {
    const found = findBlocked(inner, depth + 1)
    if (found) return found
  }
  return null
}

export const publicFetch = (async (
  input: string | URL | Request,
  init?: RequestInit
) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const problem = publicUrlProblem(raw)
  if (problem) throw new BlockedAddressError(problem)
  try {
    const response = await undiciFetch(raw, {
      ...(init as Record<string, unknown>),
      redirect: "error",
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1])
    return response as unknown as Response
  } catch (error) {
    // undici reports "fetch failed"; say why when the address was refused.
    const blocked = findBlocked(error)
    if (blocked) throw new BlockedAddressError(blocked.message)
    throw error
  }
}) as typeof fetch
