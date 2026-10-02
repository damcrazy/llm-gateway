import { describe, expect, test } from "bun:test"

import { isPublicAddress } from "@/lib/net/public-address"
import { publicUrlProblem } from "@/lib/net/public-fetch"

describe("isPublicAddress", () => {
  test("public addresses pass", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "104.18.38.10",
      "2606:4700::6810:84e5",
    ]) {
      expect(isPublicAddress(ip)).toBe(true)
    }
  })

  test("private, loopback, link-local and metadata addresses are blocked", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // AWS/Azure/GCP metadata
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe",
      "[::1]",
    ]) {
      expect(isPublicAddress(ip)).toBe(false)
    }
  })

  test("not an address", () => {
    expect(isPublicAddress("example.com")).toBe(false)
    expect(isPublicAddress("")).toBe(false)
  })
})

describe("publicUrlProblem", () => {
  test("https URLs on public hosts are fine", () => {
    expect(publicUrlProblem("https://api.openai.com/v1")).toBeNull()
    expect(publicUrlProblem("https://8.8.8.8/v1")).toBeNull()
  })

  test("blocks http, credentials, localhost and private IPs", () => {
    expect(publicUrlProblem("http://api.example.com")).toContain("https")
    expect(publicUrlProblem("https://user:pw@api.example.com")).toContain(
      "credentials"
    )
    expect(publicUrlProblem("https://localhost:11434/v1")).toContain(
      "localhost"
    )
    expect(publicUrlProblem("https://app.localhost/v1")).toContain("localhost")
    expect(publicUrlProblem("https://127.0.0.1/v1")).toContain("private")
    expect(publicUrlProblem("https://[::1]/v1")).toContain("private")
    expect(publicUrlProblem("https://169.254.169.254/latest")).toContain(
      "private"
    )
    // Other spellings of loopback are normalised by the URL parser.
    expect(publicUrlProblem("https://0x7f.1/v1")).toContain("private")
    expect(publicUrlProblem("https://2130706433/v1")).toContain("private")
    expect(publicUrlProblem("not a url")).toContain("full URL")
  })
})
