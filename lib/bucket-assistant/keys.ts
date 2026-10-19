// Keyboard handling for the assistant's message box (pure, client safe).

/**
 * Enter sends and Shift+Enter adds a line, except while an input method
 * (Hindi, Japanese, Chinese, …) is composing: that Enter confirms the text.
 */
export function isSendKey(event: {
  key: string
  shiftKey: boolean
  isComposing?: boolean
  keyCode?: number
}): boolean {
  if (event.isComposing || event.keyCode === 229) return false
  return event.key === "Enter" && !event.shiftKey
}
