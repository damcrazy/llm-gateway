import { expect, test } from "bun:test"

import { isSendKey } from "@/lib/bucket-assistant/keys"

test("Enter sends, Shift+Enter doesn't", () => {
  expect(isSendKey({ key: "Enter", shiftKey: false })).toBe(true)
  expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false)
  expect(isSendKey({ key: "a", shiftKey: false })).toBe(false)
})

test("Enter that confirms an input method's composition doesn't send", () => {
  expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(
    false
  )
  // Safari reports composition keys as keyCode 229.
  expect(isSendKey({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false)
})
