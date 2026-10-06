import { describe, expect, test } from "bun:test"

import { formatLogTime } from "@/app/(dashboard)/logs/_lib"
import { formatDateTime } from "@/lib/format"
import { validTimeZone } from "@/lib/time-zone"

// 06:12:47 UTC is 11:42:47 in India (UTC+5:30) and 23:12:47 the day before in Los Angeles.
const AT = "2026-10-06T06:12:47.000Z"

// The separator between date and time varies by ICU version ("Oct 6, " or "Oct 6 at ").
const parts = (text: string) => {
  const match = text.match(/^(\w+ \d+)(?:,| at) (.+)$/)
  return match ? [match[1], match[2]] : [text]
}

describe("formatting in the viewer's time zone", () => {
  test("log times", () => {
    expect(parts(formatLogTime(AT, "UTC"))).toEqual(["Oct 6", "06:12:47 AM"])
    expect(parts(formatLogTime(AT, "Asia/Kolkata"))).toEqual([
      "Oct 6",
      "11:42:47 AM",
    ])
    expect(parts(formatLogTime(AT, "America/Los_Angeles"))).toEqual([
      "Oct 5",
      "11:12:47 PM",
    ])
  })

  test("dates elsewhere", () => {
    expect(parts(formatDateTime(AT, "Asia/Kolkata"))).toEqual([
      "Oct 6",
      "11:42 AM",
    ])
    expect(formatDateTime(null, "Asia/Kolkata")).toBe("—")
  })
})

describe("validTimeZone", () => {
  test("accepts IANA zones", () => {
    expect(validTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata")
    expect(validTimeZone("UTC")).toBe("UTC")
  })

  test("rejects anything else", () => {
    expect(validTimeZone("Not/AZone")).toBeNull()
    expect(validTimeZone("")).toBeNull()
    expect(validTimeZone(null)).toBeNull()
    expect(validTimeZone("x".repeat(65))).toBeNull()
  })
})
