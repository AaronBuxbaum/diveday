/**
 * **A shop's rental terms** — its own plain words, printed on every rental
 * ticket above the "Received by" line (Aaron, 2026-10-08; ADR
 * 20260815-minimal-gear-register, amended 2026-10-08).
 *
 * The terms are the shop's text, never DiveDay's: nothing here supplies a
 * default, and an empty box stores nothing so a ticket prints no terms at all.
 * They make a ticket a receipt for gear with the shop's conditions on it, never
 * a liability release — the signed waiver stays the one waiver (CR-015).
 */

/** Long enough for a paragraph of house rules; short enough to print on one ticket. */
export const RENTAL_TERMS_MAX_LENGTH = 1500;

export type ParsedRentalTerms = { ok: true; terms: string | null } | { ok: false };

/**
 * Reads the Settings box: trims it, keeps its line breaks (normalized to `\n`),
 * stores an empty box as `null`, and refuses an overlong one outright rather
 * than cutting a shop's sentence in half.
 */
export function parseRentalTerms(value: unknown): ParsedRentalTerms {
  if (value === null || value === undefined) return { ok: true, terms: null };
  if (typeof value !== "string") return { ok: false };
  const terms = value.replace(/\r\n?/g, "\n").trim();
  if (terms === "") return { ok: true, terms: null };
  if (terms.length > RENTAL_TERMS_MAX_LENGTH) return { ok: false };
  return { ok: true, terms };
}
