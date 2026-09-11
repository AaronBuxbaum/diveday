#!/usr/bin/env node
/**
 * Fetch one marine-life catalog photo from Wikimedia Commons, downscale it, and
 * record its credit.
 *
 * The catalog grows (ADR 20260813-marine-life-is-diveday-copy, and the region
 * expansions the follow-up register carries), and every species needs three
 * things that have to stay in step: a JPEG under `public/marine-life/`, a
 * credit line in that folder's README, and a `MARINE_LIFE_CATALOG` entry.
 * `src/db/marine-life-catalog.test.ts` fails if the first is missing. This
 * script owns the first two so adding a species is not an exercise in
 * remembering the resize settings and the licence rules.
 *
 * Usage:
 *   node scripts/fetch-marine-life-photo.mjs <slug> --search "<Latin name>"
 *   node scripts/fetch-marine-life-photo.mjs <slug> --file "File:Some photo.jpg"
 *   node scripts/fetch-marine-life-photo.mjs --list species.tsv      (slug<TAB>search)
 *   node scripts/fetch-marine-life-photo.mjs --tiles-only            (re-derive `tiles/`)
 *
 * `--search` takes the first result whose licence is one this repo can ship,
 * which in practice is what a human would pick too; `--file` names an exact
 * Commons page when the search picks something unhelpful (a range map, a
 * specimen on a dock). `--dry-run` prints the choice without writing anything.
 *
 * **Licence is enforced, not advised.** Commons carries plenty of images this
 * repo may not bundle -- non-commercial, no-derivatives, fair-use -- and a
 * downscaled derivative on a customer-facing page is exactly the use those
 * forbid. Anything outside the allowlist below is refused with its licence
 * named, and the slug is left without a photo (a loud failure: the catalog test
 * will not pass until it has one).
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const ROOT = process.cwd();
const PHOTO_DIR = path.join(ROOT, "public", "marine-life");
const README = path.join(PHOTO_DIR, "README.md");
const API = "https://commons.wikimedia.org/w/api.php";

/**
 * The long edge, and the encoder settings the existing 93 were made with.
 * Recorded in the README as a promise to the licences ("changes indicated"),
 * so they live here rather than in a habit.
 *
 * 640 is not a taste: it is the largest candidate `next/image` ever fetches for
 * any of these. Four surfaces render a catalog species — the diver's field
 * guide and the recap's at `sizes="48px"`, the species picker at `80px`, and
 * the published-catalog preview at `(min-width: 640px) 180px, 50vw`, whose cell
 * measures 171-173px. Run through the candidate ladder in
 * `scripts/image-sizes-lib.mjs` (`fetchedCandidate`) at every viewport x DPR
 * 1/2/3, the largest request any of them makes is **640**, from the catalog
 * preview at DPR 3. A wider source is bytes the optimizer discards.
 *
 * It was 800 until 2026-09-04. The reason it could not fall before then was one
 * surface: the catalog preview declared `(min-width: 640px) 25vw, 50vw`, which
 * resolved to 480 CSS px on a 1920px screen and fetched a 960px candidate.
 * PR #1347 corrected that declaration to the slot's real 171px, which is what
 * unblocked this (issue #1337).
 *
 * Measured, not asserted: 9.45 MB -> 6.40 MB across the 149 files, and at the
 * catalog preview's own rendered size (171 CSS px at DPR 2 = 342 device px) a
 * 640-sourced render differs from an 800-sourced one by a median 40.2 dB PSNR,
 * worst 35.7. Twenty-two of these files were **already** narrower than 640 —
 * `boulder-star-coral.jpg` is 337px — so this band was shipping and accepted
 * long before it was chosen.
 *
 * **Settled 2026-09-10: this number does not move again** (issue #1337, the
 * owner's call). The ticket asked whether 800 was needed and offered shrinking
 * the catalog preview instead; both halves of it are already answered by the
 * tree, and the ticket's own figures are stale, so read these rather than it.
 * The bound is **640**, not 800, since 2026-09-04. The preview's `25vw` that
 * the question was protecting is gone, corrected to `180px` by PR #1347 for a
 * cell that measures 171-173px. And the folder is **6.81 MB across 148 files**,
 * not the 9.9 MB the ticket weighed. Nothing here is worth another round of
 * re-encoding a licensed derivative.
 *
 * The consequence for `TILE_WIDTHS` below, which arrived in the same change: it
 * may not resize, re-encode or replace any file directly under
 * `public/marine-life/`. The capture variants live one directory down and are
 * derived from these; these are what production renders.
 */
const MAX_EDGE = 640;
const JPEG = { quality: 78, mozjpeg: true };

/**
 * The capture-only variants, written beside every source into
 * `public/marine-life/tiles/<width>/<slug>.jpg`.
 *
 * These exist for one measured defect: the e2e build sets `images.unoptimized`,
 * so a capture is handed the repository's own 640px file with no srcset, and
 * Chromium then chooses how to decode it. A JPEG decoder can decode at N/8 of
 * its stored size, so whenever the source is two or more times the rendered
 * box, more than one scaled decode satisfies the draw and the choice depends on
 * what else has run in the browser process. #1597's investigation isolated
 * exactly that: twelve runs of one build on one machine, two byte-exact
 * variants, flipping about one run in three, always inside the same 171px
 * tile. That flip arrived on unrelated pull requests as a "changed" surface
 * (#1585, #1567, #1432, #1405, #1623).
 *
 * The invariant these widths establish is in `src/lib/marine-life-tiles.ts`:
 * the served file's width must lie strictly inside `(box/2, 2*box)`. Above that
 * band the decoder has a legal half-scale and therefore a choice; below it the
 * tile is upscaled past what a photograph survives. The three widths cover the
 * five boxes the app renders these at -- 48 (the diver's field guide and the
 * recap), 80 (the species picker), 224 (the trip pitch inside an embed frame,
 * whose 413px and 117px cells share no other band), and 171 (the trip pitch's three faces and
 * the published-catalog preview, which also covers the pitch's 109px phone
 * cell at 1.57x).
 *
 * `MAX_EDGE` above is untouched by this and stays where it is (issue #1337):
 * production still renders from the full-size source through the optimizer, and
 * nothing here resizes, re-encodes or replaces a file directly under
 * `public/marine-life/`.
 */
const TILE_WIDTHS = [48, 96, 171, 224];
const TILE_DIR = path.join(PHOTO_DIR, "tiles");

/**
 * Licences this repo may bundle a derivative of on a commercial page.
 * Matched case-insensitively against Commons' `LicenseShortName`, which is a
 * display string rather than an identifier -- so this is a prefix check on the
 * family, and anything carrying NC or ND is refused outright regardless.
 */
const ALLOWED = [
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

function licenceOk(name) {
  const value = (name ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value.includes("-nc") || value.includes("-nd") || value.includes("fair use")) return false;
  return ALLOWED.some((allowed) => value.startsWith(allowed));
}

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#039;": "'",
  "&nbsp;": " ",
};

/**
 * Commons wraps `Artist` and friends in markup; the credit line wants the text.
 *
 * Two things here are deliberate rather than fussy, both flagged by CodeQL on
 * the first version and both real. This is a string arriving from a third party
 * that ends up written into a file in the repo, so it gets treated like one.
 *
 * **Tags are stripped until the result stops changing.** A single pass over
 * `/<[^>]*>/` is not a sanitizer: `<scr<x>ipt>` loses the inner tag and leaves
 * `<script>` behind, which is the classic incomplete-multi-character-sanitization
 * shape.
 *
 * **Entities are decoded in one pass, not a chain of replaces.** Chained
 * replaces double-unescape — `&amp;quot;` becomes `&quot;` on the first pass and
 * then `"` on the second, so an author name containing a literal `&quot;`
 * silently turns into a quote character.
 */
function plain(html) {
  let text = html ?? "";
  for (let previous = null; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp|#0?39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

const UA = "DiveDay-catalog-tool/1.0 (https://dive.day)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request, retried through Wikimedia's rate limiter.
 *
 * A `--list` run of fifty species is fifty API calls and fifty downloads in a
 * few seconds, and upload.wikimedia.org answers a burst like that with 503s —
 * the first run of this script lost 48 of 50 photos that way, silently enough
 * that only the catalog test would have caught it. Wikimedia asks for a
 * descriptive user agent and unhurried traffic; both are the price of the
 * images being free.
 */
async function polite(url, { attempts = 4 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) {
      throw new Error(`${response.status} for ${String(url).slice(0, 90)}`);
    }
    await sleep(attempt * 1_500);
  }
}

async function api(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: "json", ...params }).toString();
  return (await polite(url)).json();
}

/** Every candidate for a query, newest API shape flattened to what we choose on. */
async function candidates({ search, file }) {
  const shared = {
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: String(MAX_EDGE),
  };
  const json = file
    ? await api({ action: "query", titles: file, ...shared })
    : await api({
        action: "query",
        generator: "search",
        gsrsearch: `filetype:bitmap ${search}`,
        gsrnamespace: "6",
        gsrlimit: "8",
        ...shared,
      });
  const pages = Object.values(json.query?.pages ?? {});
  return pages
    .filter((page) => page.imageinfo?.[0])
    .map((page) => {
      const info = page.imageinfo[0];
      const meta = info.extmetadata ?? {};
      return {
        title: page.title,
        licence: plain(meta.LicenseShortName?.value) || "unknown",
        artist: plain(meta.Artist?.value),
        // `thumburl` is Commons' own downscale; taking it rather than the
        // original saves pulling a 20 MB TIFF to make a 60 KB tile.
        url: info.thumburl ?? info.url,
        descriptionUrl: info.descriptionurl,
      };
    });
}

async function writePhoto(slug, url) {
  const response = await polite(url);
  const source = Buffer.from(await response.arrayBuffer());
  await sharp(source)
    .rotate() // bake EXIF orientation in before the metadata is stripped
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg(JPEG)
    .toFile(path.join(PHOTO_DIR, `${slug}.jpg`));
  await writeTiles(slug);
}

/**
 * The capture-only variants for one slug, derived from the file on disk rather
 * than from the download.
 *
 * Deriving them from the committed source is the point: the source is what
 * production renders and what the licences were recorded against, so a variant
 * is always a downscale of the exact bytes this repository ships, never a
 * second independent encode of a Commons original. That also makes
 * `--tiles-only` able to sweep a catalog fetched long before these existed.
 *
 * `withoutEnlargement` is deliberately absent. Twenty-two sources are already
 * narrower than 640 and one is 186px, so a strict "never enlarge" would write a
 * 186px file into the 171 slot for one species and a 96px slot would silently
 * hold something narrower for another -- which is the band this exists to
 * enforce, broken quietly. Height is unconstrained: every consumer is an
 * `object-cover` box, so the width is what the decoder is choosing a scale
 * against.
 */
async function writeTiles(slug) {
  const source = path.join(PHOTO_DIR, `${slug}.jpg`);
  for (const width of TILE_WIDTHS) {
    const dir = path.join(TILE_DIR, String(width));
    await mkdir(dir, { recursive: true });
    await sharp(source)
      .resize({ width })
      .jpeg(JPEG)
      .toFile(path.join(dir, `${slug}.jpg`));
  }
}

/**
 * One credit line, inserted in the README's alphabetical run rather than
 * appended: the list is read by a human checking a licence, and a file that
 * sorts everywhere is a file nobody can scan.
 */
async function recordCredit(slug, pick) {
  const line =
    `- \`${slug}.jpg\` — [${pick.title.replace(/^File:/, "")}](${pick.descriptionUrl})` +
    ` · ${pick.licence}${pick.artist ? ` · ${pick.artist}` : ""}`;
  const body = await readFile(README, "utf8");
  const lines = body.split("\n");
  // Matched by prefix rather than by a regex built from the slug. The slug is a
  // command-line argument, so `new RegExp(\`^- \\\`${slug}\\.jpg\\\`\`)` is a
  // regex-injection sink -- a slug carrying `.*` or an unbalanced `(` either
  // rewrites the wrong line or throws. `startsWith` cannot be injected into and
  // says the same thing.
  const prefix = `- \`${slug}.jpg\``;
  const existing = lines.findIndex((entry) => entry.startsWith(prefix));
  if (existing !== -1) {
    lines[existing] = line;
    await writeFile(README, lines.join("\n"));
    return;
  }
  const first = lines.findIndex((entry) => entry.startsWith("- `"));
  let at = lines.length;
  for (let index = first; index < lines.length; index += 1) {
    if (!lines[index].startsWith("- `")) {
      at = index;
      break;
    }
    if (lines[index] > line) {
      at = index;
      break;
    }
  }
  lines.splice(at, 0, line);
  await writeFile(README, lines.join("\n"));
}

async function one(slug, query, { dryRun, force }) {
  if (!force && existsSync(path.join(PHOTO_DIR, `${slug}.jpg`))) {
    console.log(`${slug}: already has a photo (pass --force to replace)`);
    return true;
  }
  const found = await candidates(query);
  const pick = found.find((entry) => licenceOk(entry.licence));
  if (!pick) {
    const seen = found.map((entry) => `${entry.title} (${entry.licence})`).join("; ") || "nothing";
    console.error(`${slug}: NO USABLE IMAGE — saw ${seen}`);
    return false;
  }
  console.log(`${slug}: ${pick.title} · ${pick.licence} · ${pick.artist || "no artist named"}`);
  if (dryRun) return true;
  // Spaced out rather than fired in a burst -- see `polite`.
  await sleep(400);
  await writePhoto(slug, pick.url);
  await recordCredit(slug, pick);
  return true;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const force = argv.includes("--force");
const listAt = argv.indexOf("--list");

let failures = 0;
// `--tiles-only` re-derives the capture variants for every source already on
// disk and fetches nothing. It is how the 148 photos that predate `TILE_WIDTHS`
// got theirs, and it is the one command to run after changing a width or the
// encoder settings -- Commons is not touched, so no licence decision is being
// re-made and no credit line moves.
if (argv.includes("--tiles-only")) {
  const slugs = (await readdir(PHOTO_DIR))
    .filter((entry) => entry.endsWith(".jpg"))
    .map((entry) => entry.slice(0, -".jpg".length))
    .sort();
  for (const slug of slugs) {
    try {
      await writeTiles(slug);
    } catch (error) {
      console.error(`${slug}: ${error.message}`);
      failures += 1;
    }
  }
  console.log(`${slugs.length} species x ${TILE_WIDTHS.join("/")}px written under ${TILE_DIR}`);
} else if (listAt !== -1) {
  const rows = (await readFile(argv[listAt + 1], "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"));
  for (const [slug, search] of rows) {
    try {
      if (!(await one(slug, { search }, { dryRun, force }))) failures += 1;
    } catch (error) {
      console.error(`${slug}: ${error.message}`);
      failures += 1;
    }
  }
} else {
  const slug = argv[0];
  const searchAt = argv.indexOf("--search");
  const fileAt = argv.indexOf("--file");
  if (!slug || (searchAt === -1 && fileAt === -1)) {
    console.error("usage: fetch-marine-life-photo.mjs <slug> --search <name> | --file <File:…>");
    process.exit(2);
  }
  const query = fileAt !== -1 ? { file: argv[fileAt + 1] } : { search: argv[searchAt + 1] };
  if (!(await one(slug, query, { dryRun, force }))) failures += 1;
}

if (failures > 0) {
  console.error(
    `\n${failures} species still need a photo — the catalog test will fail until they do.`,
  );
  process.exit(1);
}
