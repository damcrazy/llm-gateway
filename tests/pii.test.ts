import { describe, expect, test } from "bun:test"

import {
  describePii,
  scrubChatRequest,
  scrubDeep,
  scrubText,
  type PiiKind,
} from "@/lib/gateway/pii"

function scrub(text: string) {
  const found = new Set<PiiKind>()
  return { text: scrubText(text, found), found: [...found] }
}

describe("scrubText", () => {
  test("emails, cards (Luhn), IBANs (mod 97), SSNs, phones", () => {
    expect(scrub("Mail jane.doe+x@example.co.uk now").text).toBe(
      "Mail [EMAIL] now"
    )
    expect(scrub("Card 4242 4242 4242 4242 ok").text).toBe("Card [CARD] ok")
    expect(scrub("Card 4111-1111-1111-1111").text).toBe("Card [CARD]")
    expect(scrub("IBAN GB82 WEST 1234 5698 7654 32 please").text).toBe(
      "IBAN [IBAN] please"
    )
    expect(scrub("IBAN DE89370400440532013000").text).toBe("IBAN [IBAN]")
    expect(scrub("SSN 123-45-6789").text).toBe("SSN [SSN]")
    expect(scrub("Call +1 415 555 2671 or (020) 7946 0958").text).toBe(
      "Call [PHONE] or [PHONE]"
    )
    expect(scrub("Call +14155552671").text).toBe("Call [PHONE]")
    expect(scrub("Call 415-555-2671 or 415.555.2671.").text).toBe(
      "Call [PHONE] or [PHONE]."
    )
  })

  test("secrets", () => {
    for (const secret of [
      "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123",
      "gw_live_abcdefghijklmnopqrstuvwx",
      "AKIAIOSFODNN7EXAMPLE",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AIzaSyA-abcdefghijklmnopqrstuvwxyz01234",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ]) {
      expect(scrub(`key: ${secret} end`)).toEqual({
        text: "key: [SECRET] end",
        found: ["secret"],
      })
    }
    expect(
      scrub(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"
      ).text
    ).toBe("[SECRET]")
  })

  test("leaves ordinary text and numbers alone", () => {
    for (const text of [
      "Order 1234567890123 shipped",
      "Card 4242 4242 4242 4241",
      "It costs $1,234.56 on 2026-10-03 at 10:30",
      "Version 1.2.3, port 8080, id 550e8400-e29b-41d4-a716-446655440000",
      "IBAN GB00 WEST 1234 5698 7654 32",
      "Use the @latest tag and user@localhost",
      "ISBN 978-3-16-148410-0",
      "Call 555-1234",
    ]) {
      expect(scrub(text)).toEqual({ text, found: [] })
    }
  })
})

describe("scrubChatRequest", () => {
  test("strings, text parts and tool arguments; images untouched", () => {
    const { request, found } = scrubChatRequest({
      model: "m",
      messages: [
        { role: "system", content: "Reply to bob@example.com" },
        {
          role: "user",
          content: [
            { type: "text", text: "My card is 4242424242424242" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: {
                name: "f",
                arguments: '{"phone":"+44 20 7946 0958"}',
              },
            },
          ],
        },
      ],
    })
    expect(found.sort()).toEqual(["card", "email", "phone"])
    expect(request.messages[0]!.content).toBe("Reply to [EMAIL]")
    expect(request.messages[1]!.content).toEqual([
      { type: "text", text: "My card is [CARD]" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ])
    expect(request.messages[2]!.tool_calls![0]!.function.arguments).toBe(
      '{"phone":"[PHONE]"}'
    )
  })

  test("scrubDeep and describePii", () => {
    expect(scrubDeep({ a: ["x@y.io", 3], b: { c: "fine" } })).toEqual({
      a: ["[EMAIL]", 3],
      b: { c: "fine" },
    })
    expect(describePii(["email", "phone"])).toBe(
      "an email address and a phone number"
    )
    expect(describePii(["secret"])).toBe("an API key or secret")
  })
})
