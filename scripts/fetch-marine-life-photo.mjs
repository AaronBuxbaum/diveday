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
import { readFile, writeFile } from "node:fs/promises";
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
 */
const MAX_EDGE = 800;
const JPEG = { quality: 78, mozjpeg: true };

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

/** Commons wraps `Artist` and friends in markup; the credit line wants the text. */
function plain(html) {
  return (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
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
  if (body.includes(`\`${slug}.jpg\``)) {
    const replaced = body.replace(new RegExp(`^- \`${slug}\\.jpg\`.*$`, "m"), line);
    await writeFile(README, replaced);
    return;
  }
  const lines = body.split("\n");
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
if (listAt !== -1) {
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
