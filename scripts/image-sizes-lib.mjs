/**
 * **What a browser would actually fetch for a `sizes` attribute** — the
 * machinery behind `scripts/check-image-sizes.mjs` (issue #1350).
 *
 * Split out from the guard so it can be unit-tested directly. Everything here
 * is a pure function over strings and numbers, which is the whole point: the
 * visual suite cannot see a `sizes` regression at all, because `pnpm e2e:build`
 * sets `DIVEDAY_E2E=1`, which sets `images.unoptimized`, which makes
 * `generateImgAttrs` return `{ srcSet: undefined, sizes: undefined }`
 * (`node_modules/next/dist/shared/lib/get-img-props.js`). With no srcset there
 * is nothing for `sizes` to select from, so no capture can move — and the
 * attribute is not even in the DOM to be read, so a Playwright assertion over
 * `img.srcset`/`img.currentSrc` would pass vacuously in that build.
 *
 * That switch is right and stays: sharp's lossy re-encodes are not
 * bit-reproducible between runs, which once made the course-page captures a
 * permanent coin flip. So the check is arithmetic instead.
 */

/**
 * Next's defaults, since `next.config.ts` overrides neither. `allSizes` is the
 * candidate pool a `w`-descriptor srcset is drawn from — `getWidths` filters it
 * to `>= deviceSizes[0] * smallestRatio` and the browser picks from what's left.
 */
export const DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
export const IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];
export const ALL_SIZES = [...IMAGE_SIZES, ...DEVICE_SIZES].sort((a, b) => a - b);

const ROOT_FONT_PX = 16;

/**
 * One `<length>` from a `sizes` list, in CSS pixels at a given viewport.
 *
 * The grammar is deliberately the subset this app actually writes — `Npx`,
 * `Nvw`, `Nrem`, and `calc(100vw - Npx)` — and anything else throws rather than
 * being guessed at. A resolver that silently returned 0 for a form it did not
 * understand would make the guard report every image as under-declared, and a
 * resolver that silently returned Infinity would make it report none.
 */
export function resolveLength(length, viewportWidth) {
  const text = length.trim();

  const calc = text.match(/^calc\(\s*(\d+(?:\.\d+)?)vw\s*([+-])\s*(\d+(?:\.\d+)?)px\s*\)$/);
  if (calc) {
    const vw = (Number(calc[1]) / 100) * viewportWidth;
    const offset = Number(calc[3]);
    return calc[2] === "-" ? vw - offset : vw + offset;
  }

  const px = text.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);

  const vw = text.match(/^(\d+(?:\.\d+)?)vw$/);
  if (vw) return (Number(vw[1]) / 100) * viewportWidth;

  const rem = text.match(/^(\d+(?:\.\d+)?)rem$/);
  if (rem) return Number(rem[1]) * ROOT_FONT_PX;

  throw new Error(`unsupported length in a sizes attribute: ${JSON.stringify(text)}`);
}

/** Whether one `(min-width: …)` / `(max-width: …)` condition holds at a viewport. */
export function mediaConditionHolds(condition, viewportWidth) {
  const min = condition.match(/\(\s*min-width:\s*(\d+(?:\.\d+)?)px\s*\)/);
  const max = condition.match(/\(\s*max-width:\s*(\d+(?:\.\d+)?)px\s*\)/);
  if (!min && !max) {
    throw new Error(
      `unsupported media condition in a sizes attribute: ${JSON.stringify(condition)}`,
    );
  }
  if (min && viewportWidth < Number(min[1])) return false;
  if (max && viewportWidth > Number(max[1])) return false;
  return true;
}

/**
 * The slot width a browser resolves from a whole `sizes` list at one viewport:
 * the first entry whose media condition holds, or the bare fallback.
 *
 * Splitting on commas is safe for this app's grammar because the only function
 * form used is `calc(100vw - 56px)`, which contains no comma. A `sizes` that
 * grew one (`min(…, …)`) would need a real tokenizer, and the length resolver
 * above would throw on it first.
 */
export function resolveSizes(sizes, viewportWidth) {
  for (const rawEntry of sizes.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    if (!entry.startsWith("(")) {
      // No media condition: the fallback, which must be last and always wins.
      return resolveLength(entry, viewportWidth);
    }
    // The condition's *own* closing paren, found by depth rather than by
    // `lastIndexOf` — the length beside it may be a `calc(...)`, whose paren
    // comes later and would swallow the whole entry, leaving an empty length.
    let depth = 0;
    let conditionEnd = -1;
    for (let i = 0; i < entry.length; i += 1) {
      if (entry[i] === "(") depth += 1;
      else if (entry[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          conditionEnd = i;
          break;
        }
      }
    }
    if (conditionEnd === -1) {
      throw new Error(`unclosed media condition in a sizes attribute: ${JSON.stringify(entry)}`);
    }
    const condition = entry.slice(0, conditionEnd + 1);
    const length = entry.slice(conditionEnd + 1);
    if (mediaConditionHolds(condition, viewportWidth)) return resolveLength(length, viewportWidth);
  }
  throw new Error(`sizes list resolves to nothing at ${viewportWidth}px: ${JSON.stringify(sizes)}`);
}

/**
 * The candidate a browser fetches for a slot at a device pixel ratio: the
 * smallest in the pool that covers it, falling back to the largest.
 *
 * The pool is filtered the way `getWidths` filters it — a `sizes` whose
 * smallest `vw` is 25% drops every candidate below `640 * 0.25`, so an
 * over-declared `vw` does not merely pick a bigger file, it removes the small
 * files from the srcset entirely. That is why #1347's `25vw` -> `180px` moved
 * the fetched candidate from 1080px to 384px for a 171px slot.
 */
export function candidatePool(sizes) {
  const percentages = [...sizes.matchAll(/(^|\s)(1?\d?\d)vw/g)].map((match) => Number(match[2]));
  if (percentages.length === 0) return ALL_SIZES;
  const smallestRatio = Math.min(...percentages) * 0.01;
  return ALL_SIZES.filter((size) => size >= DEVICE_SIZES[0] * smallestRatio);
}

export function fetchedCandidate(sizes, slotCssWidth, devicePixelRatio) {
  const pool = candidatePool(sizes);
  const needed = slotCssWidth * devicePixelRatio;
  return pool.find((size) => size >= needed) ?? pool[pool.length - 1];
}

/**
 * Every `sizes` declaration in one file's source, as
 * `{ file, line, sizes, block }`.
 *
 * A `sizes` is either one literal or an expression choosing between several —
 * `TripDayPlan` picks its declaration off the length of the list it is laying
 * out, which is the honest way to write one for a conditional grid. Every
 * literal inside the expression is a declaration in its own right and each is
 * returned.
 *
 * `block` is the text from the element's own opening tag to its `sizes`, never
 * further back: the first `className` in a wider window is the *parent's*
 * (`<li className="flex min-w-0 gap-3">` wrapping a `<StoredPhoto>`), which has
 * no width class, and reading it would silently downgrade every derived
 * declaration to "needs a registry entry".
 */
export function declarationsInSource(file, text) {
  const found = [];
  for (const match of text.matchAll(/\bsizes=/g)) {
    const at = match.index + match[0].length;
    let region;
    if (text[at] === '"') {
      region = text.slice(at, text.indexOf('"', at + 1) + 1);
    } else if (text[at] === "{") {
      let depth = 0;
      let end = at;
      for (; end < text.length; end += 1) {
        if (text[end] === "{") depth += 1;
        else if (text[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      region = text.slice(at, end + 1);
    } else continue;

    const literals = [...region.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (literals.length === 0) continue;

    const line = text.slice(0, match.index).split("\n").length;
    const before = text.slice(0, match.index);
    const tagStart = Math.max(before.lastIndexOf("<"), 0);
    const block = text.slice(tagStart, match.index);

    for (const sizes of literals) found.push({ file, line, sizes, block });
  }
  return found;
}

/**
 * Every declaration across a listing of files, read through `readText`, plus
 * the listed paths that are **not on disk**.
 *
 * The guard enumerates with `git ls-files`, which is the right question —
 * "which `.tsx` files does this repository track" — but it reads the *index*,
 * so a file deleted in the working tree and not yet staged is still listed. The
 * read used to throw straight out of the guard, which turned an ordinary
 * working state (delete a file, run `pnpm check:repo` before committing) into a
 * raw Node stack trace in the middle of a concurrent 48-guard run, where it
 * reads as a broken script rather than as "stage your deletion" (issue #1763).
 * So a listed path that has vanished is reported, not thrown — and its registry
 * entries are left out of the stale sweep by the caller, because a mid-edit
 * session must not be refused for entries whose file it is in the middle of
 * deleting.
 *
 * Any other read error still throws: a permission error or a directory in the
 * listing is a broken checkout, and swallowing it would make this guard lie
 * about its own coverage.
 *
 * `passThrough` files are skipped **before** the read, not after. Their `sizes`
 * is a variable checked at the call site, so the guard does not care what is in
 * them — and reading a file only to discard it is one more path that can crash
 * for nothing.
 */
export async function declarationsInListing(listed, readText, { passThrough = new Set() } = {}) {
  const declarations = [];
  const missing = [];
  for (const file of listed) {
    if (passThrough.has(file)) continue;
    let text;
    try {
      text = await readText(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(file);
      continue;
    }
    declarations.push(...declarationsInSource(file, text));
  }
  return { declarations, missing };
}
