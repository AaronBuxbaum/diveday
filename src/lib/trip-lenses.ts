/**
 * **A lens is the shop's own word for a kind of day** — ADR
 * 20260904-reef-all-the-way-down, decision 2 (issue #1162).
 *
 * The framework-free half: how a name becomes the `?lens=` slug a diver's link
 * carries, and how that slug resolves back to a lens. Codes and rows, never
 * sentences — the words on screen are the shop's own, and the chrome around
 * them comes from `src/i18n`.
 */

/** The shape `trip_lenses.slug` holds: lowercase words joined by single hyphens. */
export const LENS_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest a lens name may be, and the longest its slug may run. */
export const LENS_NAME_MAX = 40;

/**
 * The shop's word, as a URL segment.
 *
 * Derived **once, on create**, and never rewritten: renaming "Easygoing reef"
 * to "Easy reef" must not break the link a diver shared yesterday, which is why
 * `renameTripLens` leaves the slug where it is.
 *
 * Accents fold rather than drop, so "Fotografía" is `fotografia` and not
 * `fotograf-a`; everything else that is not a letter or a digit becomes a
 * single hyphen. A name with nothing left after that ("&&&") falls back to
 * `lens`, because a row with an empty slug is a row no URL can name.
 *
 * `taken` is the shop's live slugs. A collision appends `-2`, then `-3`, and so
 * on — the same grammar a file manager uses, and the one a shop reading its own
 * URLs will guess.
 */
export function lensSlugFrom(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, LENS_NAME_MAX)
      .replace(/-+$/g, "") || "lens";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  // The suffix has to fit inside the cap too, or two long names collide again
  // at the truncation and the search never terminates.
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const stem = base.slice(0, LENS_NAME_MAX - suffix.length).replace(/-+$/g, "");
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The lens a `?lens=` parameter names, or null.
 *
 * Null for absent, malformed and unknown alike, and the caller renders the
 * unfiltered board with "Every departure" current. Deliberately **not** a
 * fallback to the first lens: a stale link from a shop that has since renamed
 * its vocabulary would otherwise show a narrowed list under somebody else's
 * word, which is worse than showing everything.
 */
export function resolveLens<T extends { slug: string }>(
  param: string | undefined,
  lenses: readonly T[],
): T | null {
  if (!param || !LENS_SLUG_PATTERN.test(param)) return null;
  return lenses.find((lens) => lens.slug === param) ?? null;
}
