/** A string as a regular-expression literal: every metacharacter escaped. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
