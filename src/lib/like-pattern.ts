/**
 * A typed needle as `like` reads it literally: `%`, `_` and the escape
 * character itself each take Postgres's default `like` escape, a backslash.
 * Unescaped, a lone `%` in a search box listed every row of the shop
 * (security review of #2579).
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/** The pattern for a literal, case-insensitive substring match. */
export function containsPattern(text: string): string {
  return `%${escapeLikePattern(text)}%`;
}
