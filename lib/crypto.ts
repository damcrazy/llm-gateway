import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto"

import { env } from "@/lib/env"

const VERSION = "v1"

let cachedKey: Buffer | undefined

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey
  const key = Buffer.from(env.encryptionKey(), "base64")
  if (key.length !== 32) {
    throw new Error(
      "GATEWAY_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)"
    )
  }
  cachedKey = key
  return key
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, ciphertext]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url")
    )
    .join(".")
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".")
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognised secret format")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export const API_KEY_PREFIX = "gw_live_"

export function generateApiKey() {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url")
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, API_KEY_PREFIX.length + 4),
    lastFour: key.slice(-4),
  }
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

/** "…ab12" style hint so the UI can show which credential is stored. */
export function secretHint(value: string): string {
  return value.length <= 8 ? "••••" : `…${value.slice(-4)}`
}

// Provider share invites: a link token (random, stored as a sha256 hash) and
// a separate 6-digit code (stored as an HMAC keyed by the encryption key and
// tied to the token, so a leaked database row can't be brute-forced).

export function generateInvite() {
  const token = randomBytes(24).toString("base64url")
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  return {
    token,
    code,
    tokenHash: hashInviteToken(token),
    codeHash: hashInviteCode(token, code),
  }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(`invite:${token}`).digest("hex")
}

export function hashInviteCode(token: string, code: string): string {
  return createHmac("sha256", encryptionKey())
    .update(`invite-code:${token}:${code}`)
    .digest("hex")
}
