/**
 * Master switch for the built-in AI chat assistant.
 *
 * `false` hides every assistant entry point (the floating bubble, the chat
 * panel, the /assistant full page, the sidebar chat list, the command-palette
 * commands, the split-pane "Assistant" option and the assistant-only Settings
 * sections) and shows a "Chat with Instinct" WhatsApp button in the sidebar
 * instead.
 *
 * The assistant code is intentionally LEFT IN PLACE. Flipping this back to
 * `true` (or reverting the PR that introduced this flag) restores the full
 * assistant exactly as it was.
 *
 * PDF markdown extraction is a separate feature and is NOT gated by this
 * flag, so existing extraction settings and statuses keep working.
 */
export const ASSISTANT_ENABLED = false;
