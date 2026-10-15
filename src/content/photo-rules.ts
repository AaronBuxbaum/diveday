/**
 * What makes a Commons photograph worth bundling — the pure half of
 * `scripts/content-photos.ts`, kept apart so every rule is tested without the
 * network or an image decoder.
 *
 * A candidate has to clear four gates, in this order, and the first it fails
 * is recorded as the reason it was refused (a refusal is never silent):
 *
 * 1. **Licence.** Only licences this repo may bundle a derivative of on a
 *    commercial page. Anything carrying NC or ND, or fair use, is refused.
 * 2. **Size.** The source's long edge must reach the folder's bound, so a
 *    bundled file is never an upscale. A 205px original stretched across a
 *    416px tile is the low-quality photo this exists to stop.
 * 3. **Relevance by description.** A title or category that says map,
 *    diagram, specimen, market stall or aquarium is not a photograph of the
 *    living animal or the place as a diver meets it.
 * 4. **The picture itself.** Too dark to read, or too soft to resolve, judged
 *    on a small greyscale render (`measure` below).
 *
 * What none of these can judge — whether the frame actually shows the subject
 * — is the reviewer's, on the contact sheet the tool renders. `accept` records
 * who looked and when; nothing reaches `public/` without that.
 */

/**
 * Licences this repo may bundle a derivative of on a commercial page.
 * Matched case-insensitively against Commons' `LicenseShortName`, which is a
 * display string rather than an identifier — so a prefix check on the family,
 * with NC, ND and fair use refused outright regardless.
 */
export const ALLOWED_LICENCES = [
  "public domain",
  "no restrictions",
  "cc0",
  "cc by 2.0",
  "cc by 2.5",
  "cc by 3.0",
  "cc by 4.0",
  "cc by-sa 2.0",
  "cc by-sa 2.5",
  "cc by-sa 3.0",
  "cc by-sa 4.0",
];

export function licenceOk(name: string | null | undefined): boolean {
  const value = (name ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value.includes("-nc") || value.includes("-nd") || value.includes("fair use")) return false;
  return ALLOWED_LICENCES.some((allowed) => value.startsWith(allowed));
}

export type PhotoFolder = "marine-life" | "dive-sites";

/**
 * The two folders a vetted photo can land in, and what each asks of a source.
 *
 * `bound` is the long edge the bundled file is written at; `minSource` is the
 * smallest original that can fill it without an upscale. They are the same
 * number on purpose.
 */
export const FOLDERS: Record<PhotoFolder, { bound: number; minSource: number; quality: number }> = {
  "marine-life": { bound: 640, minSource: 640, quality: 78 },
  "dive-sites": { bound: 1024, minSource: 1024, quality: 80 },
};

/**
 * Words in a Commons title or category that mean "not a photograph of this
 * subject as a diver meets it". Whole words, case-insensitive. Kept short and
 * literal: each one is a kind of image that turned up in a real search and
 * would have been wrong on a briefing.
 */
export const IRRELEVANT_WORDS = [
  "map",
  "maps",
  "diagram",
  "chart",
  "drawing",
  "illustration",
  "engraving",
  "lithograph",
  "painting",
  "plate",
  "specimen",
  "specimens",
  "museum",
  "herbarium",
  "preserved",
  "fossil",
  "skeleton",
  "skull",
  "dead",
  "market",
  "fishmonger",
  "frozen",
  "caught",
  "catch",
  "fishing",
  "angler",
  "cooked",
  "dish",
  "aquarium",
  "stamp",
  "logo",
  "coin",
];

const IRRELEVANT = new RegExp(`\\b(${IRRELEVANT_WORDS.join("|")})\\b`, "i");

/** The first irrelevant word a title or category list carries, or null. */
export function irrelevantWord(
  title: string | null | undefined,
  categories: readonly string[] = [],
): string | null {
  for (const text of [title ?? "", ...categories]) {
    const hit = IRRELEVANT.exec(text.replace(/[_-]/g, " "));
    if (hit) return (hit[1] ?? "").toLowerCase();
  }
  return null;
}

/**
 * The picture's own quality, from a greyscale render: `highlights` is the
 * 95th-percentile luminance (0-255) and `sharpness` is the variance of a 3x3
 * Laplacian, the standard focus measure. Pass the raw 8-bit single-channel
 * buffer.
 *
 * Highlights rather than the mean, because a lit subject on black water is a
 * good photograph with a mean near 20 (a banded coral shrimp at night); what
 * is unreadable is a frame whose *brightest* part is still dim.
 */
export type Measured = { highlights: number; sharpness: number };

export function measure(pixels: ArrayLike<number>, width: number, height: number): Measured {
  const histogram = new Array<number>(256).fill(0);
  for (let index = 0; index < pixels.length; index += 1)
    histogram[pixels[index] ?? 0] = (histogram[pixels[index] ?? 0] ?? 0) + 1;
  let highlights = 255;
  for (let level = 255, seen = 0; level >= 0; level -= 1) {
    seen += histogram[level] ?? 0;
    if (seen >= pixels.length * 0.05) {
      highlights = level;
      break;
    }
  }
  let lapSum = 0;
  let lapSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const px = (offset: number) => pixels[at + offset] ?? 0;
      const lap = px(-width) + px(width) + px(-1) + px(1) - 4 * px(0);
      lapSum += lap;
      lapSquares += lap * lap;
      count += 1;
    }
  }
  const lapMean = count ? lapSum / count : 0;
  const sharpness = count ? lapSquares / count - lapMean * lapMean : 0;
  return { highlights, sharpness };
}

/**
 * The floor a measured picture must clear, at the 512px greyscale render the
 * tool measures at. Calibrated against the 148 catalog photographs that were
 * already bundled (`pnpm content:photos audit` prints both numbers for every
 * file): underwater frames are blue and soft by nature, so these refuse only
 * what is unreadable. The two bundled photographs under the sharpness floor
 * were a sand flat with the garden eels lost in it and a public-aquarium
 * tank; the softest frame a reviewer judged readable (a crow's nest seen
 * through 20 m of blue water) measures 23, and every lit-on-black night frame
 * clears the highlights floor.
 */
export const QUALITY_FLOOR = { highlights: 70, sharpness: 20 };

export function qualityProblem({ highlights, sharpness }: Measured): string | null {
  if (highlights < QUALITY_FLOOR.highlights) return `too dark (highlights ${highlights})`;
  if (sharpness < QUALITY_FLOOR.sharpness) return `too soft (sharpness ${sharpness.toFixed(1)})`;
  return null;
}

/**
 * Why a candidate is refused, or null when it may go on the contact sheet.
 * `folder` is a key of `FOLDERS`. The measure is optional: the size and words
 * are checked before anything is downloaded.
 */
export type Candidate = {
  title: string;
  licence: string;
  width?: number;
  height?: number;
  categories?: readonly string[];
};

export function refusal(
  candidate: Candidate,
  folder: PhotoFolder,
  measured?: Measured,
): string | null {
  if (!licenceOk(candidate.licence)) return `licence ${candidate.licence || "unknown"}`;
  const longEdge = Math.max(candidate.width ?? 0, candidate.height ?? 0);
  const { minSource } = FOLDERS[folder];
  if (longEdge < minSource) return `source ${longEdge}px, below ${minSource}px`;
  const word = irrelevantWord(candidate.title, candidate.categories);
  if (word) return `described as “${word}”`;
  if (measured) return qualityProblem(measured);
  return null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#039;": "'",
  "&nbsp;": " ",
};

/**
 * Commons wraps `Artist` and friends in markup; the credit wants the text.
 * Tags are stripped until the result stops changing (one pass over
 * `<[^>]*>` is not a sanitizer: `<scr<x>ipt>` leaves `<script>`), and
 * entities are decoded in one pass so `&amp;quot;` cannot double-unescape.
 */
export function plain(html: string | null | undefined): string {
  let text = html ?? "";
  for (let previous: string | null = null; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp|#0?39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}
