/**
 * Capture-only marine-life photo variants, and the band that makes a photograph
 * decode the same way twice.
 *
 * **The defect.** `next.config.ts` sets `images.unoptimized` for the e2e build,
 * which was the right fix for sharp's non-reproducible re-encode and left a
 * second nondeterminism behind it: with no srcset, the browser is handed the
 * repository's own 640px file and decides for itself how to decode it. A JPEG
 * decoder can decode at N/8 of the stored size, so as soon as the source is two
 * or more times the rendered box, more than one scaled decode satisfies the
 * draw — and which one Chromium takes depends on what its decode cache already
 * holds, which is to say on what else has run in the browser process.
 *
 * #1597's investigation measured exactly that shape: twelve runs of one build
 * on one machine produced two byte-exact variants, flipping about one run in
 * three, always inside the same 171px tile, with progressive JPEG, the SIMD
 * path, the viewport loop, an unsettled frame and raster scheduling all ruled
 * out. Downstream it arrived as `site-briefing` and `booking-pitch-open`
 * reporting "changed" on pull requests that render nothing (#1585, #1567,
 * #1432, #1405, #1623) — a recurring shimmer that trains a reviewer to wave
 * visual diffs through, which is the one failure the visual suite exists to
 * prevent.
 *
 * **The invariant.** The served file's width must lie strictly inside
 * `(box / 2, 2 * box)`. The upper half is the determinism guarantee: under
 * `2 * box` there is no legal half-scale decode, so there is one decode and one
 * fixed resample. The lower half is the "still a photograph" guarantee: a file
 * narrower than half its box is being enlarged past what these tiles survive.
 *
 * **What this is not.** It does not resize, re-encode or replace anything under
 * `public/marine-life/` — the sources stay exactly where they are (issue
 * #1337), and production still renders them full-size through the optimizer,
 * byte-for-byte as it does today. Only a capture is served a variant, and only
 * because a capture is the one context with no srcset to choose from.
 *
 * The variants are written by `scripts/fetch-marine-life-photo.mjs`
 * (`--tiles-only` re-derives the whole set); `src/db/marine-life-catalog.test.ts`
 * fails if a species is missing one.
 */

/**
 * The committed variant widths, chosen for the four boxes the app actually
 * renders a catalog species at.
 *
 * - **48** — the diver's field guide (`TripDayPlan`) and the recap's
 *   (`AfterState`), both `size-12`. 1.00x.
 * - **96** — the species picker in the dive-site editor, `h-16 w-20`. 1.20x.
 * - **171** — the trip pitch's three faces (`TripPitch`) and the published
 *   catalog preview (`dive-sites/page.tsx`). 1.00x on the desktop cell and
 *   0.99x on the catalog's measured 173; it also serves the pitch's 109px
 *   phone cell at 1.57x, which is inside the band.
 * - **224** — the trip pitch inside an embed frame, whose column is `w-full`
 *   rather than `max-w-xl`: a 413px cell at 1280 and a 117px one at 390,
 *   measured off the capture. Those two bands overlap only in (206.5, 234), so
 *   this width exists because no other committed one can serve both — and 640,
 *   the source, is far outside the phone half.
 *
 * Adding a width means running `--tiles-only` and committing 148 more files;
 * the whole set is 1.19 MB, measured, against 6.81 MB of sources.
 */
export const MARINE_LIFE_TILE_WIDTHS = [48, 96, 171, 224] as const;

/**
 * Only `/marine-life/<slug>.jpg`, and nothing deeper.
 *
 * Anchored and slash-free on purpose. It refuses a path that is already a
 * variant (`/marine-life/tiles/171/...`), so a call site wrapped twice is a
 * no-op rather than a 404, and it cannot be talked into traversal by a string
 * that reached here from anywhere but `marineLifeImage`.
 */
const BUNDLED_PHOTO = /^\/marine-life\/([a-z0-9-]+\.jpg)$/;

/**
 * The committed width to serve for a box of `boxPx` CSS pixels.
 *
 * Throws when the nearest committed width falls outside `(boxPx/2, 2*boxPx)`.
 * That refusal is the point of the function: a new surface rendering these at
 * some other size is a surface that has quietly reintroduced the decode choice
 * (or is enlarging a thumbnail into a hero), and it should fail loudly at the
 * first render rather than show up months later as an unexplained visual diff.
 * The fix when it fires is to add the width to `MARINE_LIFE_TILE_WIDTHS` and
 * re-run `scripts/fetch-marine-life-photo.mjs --tiles-only`.
 */
export function tileWidthFor(boxes: number | readonly number[]): number {
  const rendered = typeof boxes === "number" ? [boxes] : [...boxes];
  if (rendered.length === 0) {
    throw new RangeError("marine-life tile: a surface renders at least one box size");
  }
  for (const box of rendered) {
    if (!Number.isFinite(box) || box <= 0) {
      throw new RangeError(`marine-life tile: ${box} is not a rendered box size`);
    }
  }
  // One file is served to every viewport — there is no srcset in a capture — so
  // the width has to sit inside the band of EVERY box the surface renders, not
  // just the widest. Taking the widest alone is what put a 171px file into the
  // embed's 413px cell and softened three photographs (PR #1663).
  const low = Math.max(...rendered.map((box) => box / 2));
  const high = Math.min(...rendered.map((box) => box * 2));
  const inBand = MARINE_LIFE_TILE_WIDTHS.filter((width) => width > low && width < high);
  if (inBand.length === 0) {
    throw new RangeError(
      `marine-life tile: boxes ${rendered.join(", ")} share no committed width inside (${low}, ${high}) — committed are ${MARINE_LIFE_TILE_WIDTHS.join(
        ", ",
      )}. Add one to MARINE_LIFE_TILE_WIDTHS and run ` +
        "`node scripts/fetch-marine-life-photo.mjs --tiles-only`.",
    );
  }
  const widest = Math.max(...rendered);
  return inBand.reduce((best, width) =>
    Math.abs(width - widest) < Math.abs(best - widest) ? width : best,
  );
}

/**
 * The photo URL to render, given the box it is rendered into.
 *
 * Returns its argument unchanged everywhere except an e2e capture, so this is
 * invisible to production by construction rather than by care: the same
 * harness-boundary shape as `DIVEDAY_CLOCK` and as the synthetic tide turns in
 * `src/lib/tide-predictions.ts`, and read only in server components, so there
 * is no `NEXT_PUBLIC_` copy of the flag for a bundle to inline as `undefined`.
 *
 * Pass **every** box the surface renders, not just the widest. A capture has no
 * srcset, so one file is drawn into all of them, and the width has to satisfy
 * every band at once. A single number is the shorthand for a surface whose cell
 * is the same at every viewport (a `size-12` avatar); anything responsive passes
 * the pair.
 */
export function capturePhoto(imageUrl: string, boxes: number | readonly number[]): string {
  if (process.env.DIVEDAY_E2E !== "1") return imageUrl;
  const bundled = BUNDLED_PHOTO.exec(imageUrl);
  if (!bundled) return imageUrl;
  return `/marine-life/tiles/${tileWidthFor(boxes)}/${bundled[1]}`;
}
