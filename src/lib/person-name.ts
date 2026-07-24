/**
 * Name matching for the identity-reuse safeguard (H-13).
 *
 * A self-service booking is keyed to a person by `(shop, lower(email))`. When an
 * email matches an existing person we must decide whether the *name* submitted
 * plausibly belongs to that same person, or whether a different human is
 * booking under a shared inbox (a spouse, or a minor booked under a parent's
 * email) and would silently inherit the matched person's verified certs and
 * current waiver. This module answers only that narrow question; the policy
 * (flag the booking, block readiness, require staff confirmation) lives in the
 * booking flow and the readiness engine.
 *
 * The comparison fails toward "does not match" — a genuine mismatch is never
 * missed. It tolerates only the noise that is *not* a different person (case,
 * accents, punctuation, word order, and a middle initial), because a
 * safeguard that fires on every re-typed middle initial trains staff to
 * confirm reflexively, which is as unsafe as not firing at all. Anything that
 * changes an actual name token — a different first or last name, an added or
 * dropped surname — is a mismatch and routes to staff confirmation.
 */

/**
 * Fold a name to its comparison form: lower-cased, accent-stripped, with every
 * run of non-letter/non-number collapsed to a single space and trimmed. So
 * "  José  Q. Díaz " and "jose q diaz" fold to the same "jose q diaz".
 */
export function normalizePersonName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      // Apostrophes join rather than split: "O'Brien" is one name, "obrien",
      // not "o brien" — so it still matches an apostrophe-free re-entry.
      .replace(/['’]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/**
 * The significant name tokens: normalized words of length ≥ 2, so a middle
 * initial ("q" in "Nora Q. Quinn") is dropped rather than treated as a name of
 * its own. Returned as a set so word order never matters.
 */
function significantNameTokens(name: string): Set<string> {
  return new Set(
    normalizePersonName(name)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

/**
 * Whether two names plausibly belong to the same person: their significant
 * tokens are the same set, regardless of case, accents, punctuation, order, or
 * middle initials. Two names with no significant token between them (only
 * initials or punctuation) never match — an unusable name must not be a silent
 * pass.
 */
export function personNamesMatch(a: string, b: string): boolean {
  const ta = significantNameTokens(a);
  const tb = significantNameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size !== tb.size) return false;
  for (const token of ta) if (!tb.has(token)) return false;
  return true;
}
