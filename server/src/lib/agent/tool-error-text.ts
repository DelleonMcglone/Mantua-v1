/**
 * What a failed agent tool shows the user (and tells the model). A refusal
 * the product wrote on purpose ("That is over your daily limit.") passes
 * through. A low-level failure — an RPC or contract-read error with
 * addresses, ABI text and library links — is replaced by one plain sentence;
 * the original goes to the audit row and the server log, not the screen.
 */
const TECHNICAL =
  /contract function|returned no data|viem|https?:\/\/|\b0x[0-9a-fA-F]{16,}|\brevert|ECONN|ETIMEDOUT|fetch failed|HTTP request failed|JSON-RPC|RPC Request|at async|\bstack\b|SQL|relation "|violates/i;

export const GENERIC_TOOL_ERROR = "That couldn't be loaded just now. Please try again in a moment.";

export function userFacingToolError(raw: string): string {
  const text = raw.trim();
  if (!text) return GENERIC_TOOL_ERROR;
  if (text.length > 240 || TECHNICAL.test(text)) return GENERIC_TOOL_ERROR;
  return text;
}
