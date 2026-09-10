/**
 * **A name a shop typed, as a URL segment.**
 *
 * One grammar, because this repository now puts three of them in URLs — a
 * kind of day (`?lens=after-dark`), a course (`/s/<shop>/courses/open-water`)
 * and a dive site (`/s/<shop>/sites/molasses-reef`) — and three hand-rolled
 * `toLowerCase().replace(...)` chains is how two of them quietly disagree
 * about what happens to an accent.
 *
 * Accents **fold** rather than drop, so "Fotografía" is `fotografia` and not
 * `fotograf-a`; everything else that is not a letter or a digit becomes a
 * single hyphen, and leading and trailing hyphens go. A name with nothing left
 * after that ("&&&") takes the caller's `fallback`, because a row with an
 * empty slug is a row no URL can name.
 *
 * `taken` is the slugs already in use in whatever scope the URL has to be
 * unique in. A collision appends `-2`, then `-3`, and so on — the grammar a
 * file manager uses, and the one a shop reading its own URLs will guess. The
 * suffix is counted **inside** the length cap, or two long names collide again
 * at the truncation and the search never terminates.
 */
export function slugFrom(
  name: string,
  { max, fallback, taken = [] }: { max: number; fallback: string; taken?: Iterable<string> },
): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || fallback;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const stem = base.slice(0, max - suffix.length).replace(/-+$/g, "");
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
