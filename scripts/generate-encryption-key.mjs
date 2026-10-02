#!/usr/bin/env node
// Generates a GATEWAY_ENCRYPTION_KEY: 32 random bytes, base64 encoded.
// The gateway uses it to encrypt provider credentials (AES-256-GCM).
//
//   node scripts/generate-encryption-key.mjs
//   bun run generate:key

import { randomBytes } from "node:crypto"

const key = randomBytes(32).toString("base64")

console.log(`
GATEWAY_ENCRYPTION_KEY=${key}

- Add it to your environment (Vercel project settings, or .env for Docker).
- Save a copy in your password manager. If it's lost or changed, the stored
  provider credentials can't be decrypted and must be re-entered.
- Use a different key for each environment (local, production).
`)
