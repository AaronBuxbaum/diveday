/** The longest eLearning code a shop can paste; agencies' codes are far shorter. */
export const MAX_ELEARNING_CODE_LENGTH = 64;
/** The most codes one paste can add, so a slipped paste of a whole spreadsheet is refused whole. */
export const MAX_ELEARNING_CODES_PER_PASTE = 500;

export type ParsedElearningCodes =
  | { ok: true; codes: string[]; repeated: number }
  | { ok: false; reason: "too_many" | "too_long" };

/**
 * **Read what a shop pasted into its codes box** (ADR 20261120-course-elearning-codes): one code
 * per line, or separated by commas, semicolons or spaces, as an agency's order email or a
 * spreadsheet column arrives. A code is kept exactly as typed (agencies' codes are case-sensitive
 * to the eye of whoever reads them out), and a code repeated within the paste counts once. Never
 * writes anything.
 */
export function parseElearningCodes(raw: string): ParsedElearningCodes {
  const tokens = raw.split(/[\s,;]+/).filter((token) => token.length > 0);
  const codes = [...new Set(tokens)];
  if (codes.length > MAX_ELEARNING_CODES_PER_PASTE) return { ok: false, reason: "too_many" };
  if (codes.some((code) => code.length > MAX_ELEARNING_CODE_LENGTH)) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, codes, repeated: tokens.length - codes.length };
}
