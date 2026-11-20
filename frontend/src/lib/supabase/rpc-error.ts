/**
 * Message for a failed database call. Our own database rules raise
 * human-readable messages (P0001 business rule, 22023 invalid input, 42501 not
 * allowed, 23514 / 23502 failed check), which are safe to show. Anything else,
 * including Postgres' own constraint and row-level-security wording, gets the
 * generic fallback.
 */
const OWN_MESSAGE_CODES = ["P0001", "22023", "42501", "23514", "23502"];

export function rpcErrorMessage(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error?.message || !OWN_MESSAGE_CODES.includes(error.code ?? "")) return fallback;
  if (/row-level security|permission denied|violates/i.test(error.message)) return fallback;
  const text = error.message.replace(/^(metric_entries|metric_definitions|scoring_rules): /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
