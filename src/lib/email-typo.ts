/**
 * A gentle "did you mean gmail.com?" for a booking email — the one field a
 * diver's whole trip (confirmation, waiver, readiness link) hangs off. It is a
 * nudge, never a gate: the booking form still submits whatever was typed, and
 * this only ever *offers* a correction the diver can take in one tap.
 *
 * The bar is deliberately conservative. A false positive tells someone their
 * real address is wrong, which is worse than missing a typo, so we only suggest
 * when a domain is exactly one edit away from a well-known provider. `gmx.com`,
 * `me.com`, and company domains are several edits from anything on the list and
 * are left alone.
 */

/** The providers common enough that a near-miss is almost always a slip. */
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "live.com",
  "msn.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
] as const;

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition),
 * so a swapped pair like `gmial` reads as one mistake, not two.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * A corrected address to offer, or `null` when the email is empty, structurally
 * unusable, already on a known domain, or too far from any of them to be a
 * confident typo. Only the domain is ever changed; the local part is preserved.
 */
export function suggestEmailTypo(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  // A domain needs a dot to be worth comparing, and an exact match is correct.
  if (!domain.includes(".")) return null;
  if ((COMMON_DOMAINS as readonly string[]).includes(domain)) return null;

  // COMMON_DOMAINS is non-empty, so the reduce always yields a nearest match.
  const best = COMMON_DOMAINS.map((candidate) => ({
    domain: candidate,
    distance: editDistance(domain, candidate),
  })).reduce((nearest, candidate) => (candidate.distance < nearest.distance ? candidate : nearest));
  // One edit away is a confident slip; two or more risks a real address.
  if (best.distance !== 1) return null;
  return `${local}@${best.domain}`;
}
