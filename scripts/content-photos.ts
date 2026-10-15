#!/usr/bin/env tsx
/**
 * Every photograph DiveDay bundles for its starting content, found, vetted and
 * credited by one tool: `pnpm content:photos <command>`.
 *
 * Two folders, one rulebook (`src/content/photo-rules.ts`), one ledger
 * (`src/content/photo-records.json`):
 *
 * - `public/marine-life/<slug>.jpg` — one per catalog species, 640px, plus
 *   the capture-only tiles beside it.
 * - `public/dive-sites/<name>.jpg` — a dive-site template's cover, and the
 *   demo seed's site and landmark photos, 1024px.
 *
 * `src/content/photo-records.test.ts` fails when a species has no vetted
 * photo, when a template has neither a photo nor a recorded reason for having
 * none, or when a bundled file has no record — so a seed or catalog edit that
 * skips this tool is red before it merges.
 *
 * The loop, for any subject (`species:<slug>`, `site:<template-slug>`):
 *
 *   pnpm content:photos todo [--area <code>] [--kind species|site]
 *   pnpm content:photos candidates <subject> [--search "<words>"] [--file "File:…"]
 *       [--scientific "<binomial>"]   (a species not yet in the catalog)
 *       → refuses what fails the rules, with the reason, and renders the rest
 *         as a numbered contact sheet under .content-review/<subject>/
 *   (look at the sheet: does each frame show the subject, as a diver meets it?)
 *   pnpm content:photos accept <subject> <n> [--crop left,top,width,height]
 *   pnpm content:photos none <subject> --reason "<why no candidate qualifies>"
 *
 * And the maintenance commands:
 *
 *   pnpm content:photos audit            every bundled file against today's rules
 *   pnpm content:photos sheet <file…>    a contact sheet of bundled files, for review
 *   pnpm content:photos reviewed <file…> record that a bundled file was looked at and kept
 *   pnpm content:photos adopt            records for bundled files that have none (from Commons)
 *   pnpm content:photos readme           rewrite both folders' credit lists from the ledger
 *   pnpm content:photos tiles            re-derive the marine-life capture tiles
 *
 * Wikimedia asks for a descriptive user agent and unhurried traffic; every
 * request here carries one, is spaced out, is retried through 429/5xx, and is
 * abandoned after 30 seconds rather than hanging a run.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { DIVE_AREA_BY_CODE } from "../src/content/dive-areas";
import { DIVE_SITE_TEMPLATES } from "../src/content/dive-site-templates";
import {
  type PhotoRecords,
  photoRecordsPath,
  readPhotoRecords,
  renderCredits,
  subjectFolder,
  writePhotoRecords,
} from "../src/content/photo-records";
import {
  type Candidate,
  FOLDERS,
  measure,
  type PhotoFolder,
  plain,
  refusal,
} from "../src/content/photo-rules";
import { MARINE_LIFE_CATALOG } from "../src/db/marine-life-catalog";
import { MARINE_LIFE_TILE_WIDTHS } from "../src/lib/marine-life-tiles";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");
const REVIEW = path.join(ROOT, ".content-review");
const API = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const UA = "DiveDay-content-tool/1.0 (https://dive.day; content photo vetting)";
const REQUEST_TIMEOUT_MS = 30_000;
const MEASURE_EDGE = 512;
const SHEET_TILE = 320;
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function polite(url: URL | string, attempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) {
      throw new Error(`${response.status} for ${String(url).slice(0, 100)}`);
    }
    await sleep(attempt * 1_500);
  }
}

async function api(base: string, params: Record<string, string>) {
  const url = new URL(base);
  url.search = new URLSearchParams({ format: "json", ...params }).toString();
  await sleep(300);
  // biome-ignore lint/suspicious/noExplicitAny: the MediaWiki response is read field by field below
  return (await (await polite(url)).json()) as any;
}

type Found = Candidate & {
  url: string;
  thumb: string;
  descriptionUrl: string;
  artist: string;
  /** Where it came from: Wikidata's chosen image, the taxon category, or a search. */
  via: string;
};

const INFO = {
  prop: "imageinfo|categories",
  iiprop: "url|extmetadata|size",
  iiurlwidth: String(MEASURE_EDGE),
  cllimit: "50",
  clshow: "!hidden",
};

// biome-ignore lint/suspicious/noExplicitAny: a MediaWiki page object
function toFound(page: any, via: string): Found | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  return {
    title: page.title,
    licence: plain(meta.LicenseShortName?.value) || "unknown",
    artist: plain(meta.Artist?.value),
    width: info.width,
    height: info.height,
    // biome-ignore lint/suspicious/noExplicitAny: a MediaWiki category object
    categories: (page.categories ?? []).map((category: any) =>
      String(category.title).replace(/^Category:/, ""),
    ),
    url: info.url,
    thumb: info.thumburl ?? info.url,
    descriptionUrl: info.descriptionurl,
    via,
  };
}

async function filesByTitle(titles: string[], via: string): Promise<Found[]> {
  if (titles.length === 0) return [];
  const json = await api(API, { action: "query", titles: titles.join("|"), ...INFO });
  return Object.values(json.query?.pages ?? {})
    .map((page) => toFound(page, via))
    .filter((found): found is Found => found !== null);
}

async function filesInCategory(category: string): Promise<Found[]> {
  const json = await api(API, {
    action: "query",
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmtype: "file",
    gcmlimit: "40",
    ...INFO,
  });
  return Object.values(json.query?.pages ?? {})
    .map((page) => toFound(page, `category ${category}`))
    .filter((found): found is Found => found !== null);
}

async function filesBySearch(words: string): Promise<Found[]> {
  const json = await api(API, {
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${words}`,
    gsrnamespace: "6",
    gsrlimit: "25",
    ...INFO,
  });
  return Object.values(json.query?.pages ?? {})
    .map((page) => toFound(page, `search “${words}”`))
    .filter((found): found is Found => found !== null);
}

/** The image Wikidata's editors chose for this taxon, which is usually the best one. */
async function wikidataImage(scientificName: string): Promise<string[]> {
  const search = await api(WIKIDATA, {
    action: "query",
    list: "search",
    srsearch: `haswbstatement:P225="${scientificName}"`,
    srlimit: "1",
  });
  const id = search.query?.search?.[0]?.title;
  if (!id) return [];
  const entity = await api(WIKIDATA, { action: "wbgetclaims", entity: id, property: "P18" });
  // biome-ignore lint/suspicious/noExplicitAny: a Wikidata claim
  return (entity.claims?.P18 ?? []).map((claim: any) => `File:${claim.mainsnak.datavalue.value}`);
}

const INATURALIST = "https://api.inaturalist.org/v1/observations";
const INAT_LICENCES: Record<string, string> = {
  cc0: "CC0",
  "cc-by": "CC BY 4.0",
  "cc-by-sa": "CC BY-SA 4.0",
};

/**
 * Research-grade iNaturalist observations of the taxon, most-voted first,
 * keeping only photographs whose own licence is one the rules allow. Every
 * iNaturalist photo carries its observer's licence, so the filter is per
 * photo, not per observation.
 */
async function inaturalistPhotos(scientificName: string): Promise<Found[]> {
  const url = new URL(INATURALIST);
  url.search = new URLSearchParams({
    taxon_name: scientificName,
    quality_grade: "research",
    photo_license: Object.keys(INAT_LICENCES).join(","),
    order_by: "votes",
    photos: "true",
    per_page: "20",
  }).toString();
  await sleep(1_000);
  // biome-ignore lint/suspicious/noExplicitAny: an iNaturalist response, read field by field
  const json = (await (await polite(url)).json()) as any;
  const found: Found[] = [];
  for (const observation of json.results ?? []) {
    for (const photo of observation.photos ?? []) {
      const licence = INAT_LICENCES[photo.license_code ?? ""];
      if (!licence || !photo.url) continue;
      const artist = plain(String(photo.attribution ?? ""))
        .replace(/^\(c\)\s*/i, "")
        .replace(/,\s*(some|no) rights reserved.*$/i, "")
        .trim();
      found.push({
        title: `inaturalist:${photo.id}`,
        licence,
        artist,
        width: photo.original_dimensions?.width,
        height: photo.original_dimensions?.height,
        categories: [],
        url: String(photo.url).replace("/square.", "/original."),
        thumb: String(photo.url).replace("/square.", "/medium."),
        descriptionUrl: `https://www.inaturalist.org/photos/${photo.id}`,
        via: "inaturalist",
      });
      break; // one photo per observation: the observer's chosen first frame
    }
  }
  return found;
}

type Subject =
  | { kind: "species"; id: string; slug: string; scientificName: string }
  | { kind: "site"; id: string; slug: string; name: string; areaLabel: string };

function subjectFor(id: string, flags: Flags = {}): Subject {
  const [kind, slug] = id.split(":");
  if (kind === "species") {
    const entry = MARINE_LIFE_CATALOG.find((species) => species.slug === slug);
    // A species being added names its binomial up front, so its photo can be
    // chosen in the same change that writes its catalog row.
    if (!entry && flags.scientific && slug) {
      return { kind, id, slug, scientificName: flags.scientific };
    }
    if (!entry) throw new Error(`${id}: no such species in src/db/marine-life-catalog.ts`);
    return { kind, id, slug: entry.slug, scientificName: entry.scientificName };
  }
  if (kind === "site") {
    const template = DIVE_SITE_TEMPLATES.find((site) => site.slug === slug);
    if (!template) throw new Error(`${id}: no such template in src/content/dive-sites/`);
    const areaLabel = DIVE_AREA_BY_CODE.get(template.area)?.label ?? "";
    return { kind, id, slug: template.slug, name: template.briefing.name, areaLabel };
  }
  throw new Error(`${id}: a subject is species:<slug> or site:<template-slug>`);
}

async function gather(subject: Subject, flags: Flags): Promise<Found[]> {
  const pools: Found[][] = [];
  if (flags.file) pools.push(await filesByTitle([flags.file], "named"));
  if (subject.kind === "species") {
    // A search the reviewer typed goes first: the taxon category can hold forty
    // market and aquarium frames that would otherwise fill every slot.
    if (flags.search) pools.push(await filesBySearch(flags.search));
    pools.push(await filesByTitle(await wikidataImage(subject.scientificName), "wikidata"));
    // iNaturalist's most-voted research-grade frames before the raw Commons
    // category, which is often fish markets, museum jars and aquarium tanks.
    pools.push(await inaturalistPhotos(subject.scientificName));
    pools.push(await filesInCategory(subject.scientificName));
    if (!flags.search) pools.push(await filesBySearch(`"${subject.scientificName}"`));
  } else {
    if (flags.category) pools.push(await filesInCategory(flags.category));
    pools.push(await filesBySearch(flags.search ?? `"${subject.name}" ${subject.areaLabel}`));
  }
  const seen = new Set<string>();
  return pools.flat().filter((found) => !seen.has(found.title) && seen.add(found.title));
}

async function measured(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(MEASURE_EDGE, MEASURE_EDGE, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return measure(data, info.width, info.height);
}

function reviewDir(id: string) {
  return path.join(REVIEW, id.replace(/[^a-z0-9-]+/gi, "_"));
}

async function contactSheet(files: { buffer: Buffer; label: string }[], out: string) {
  const columns = 4;
  const tiles = await Promise.all(
    files.map(async ({ buffer, label }, index) => {
      const caption = Buffer.from(
        `<svg width="${SHEET_TILE}" height="26"><rect width="${SHEET_TILE}" height="26" fill="black"/>` +
          `<text x="6" y="19" font-family="sans-serif" font-size="16" fill="white">${label
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .slice(0, 38)}</text></svg>`,
      );
      return {
        input: await sharp(buffer)
          .rotate()
          .resize(SHEET_TILE, SHEET_TILE, { fit: "contain", background: "#ffffff" })
          .composite([{ input: caption, top: 0, left: 0 }])
          .jpeg()
          .toBuffer(),
        left: (index % columns) * SHEET_TILE,
        top: Math.floor(index / columns) * SHEET_TILE,
      };
    }),
  );
  await sharp({
    create: {
      width: columns * SHEET_TILE,
      height: Math.max(1, Math.ceil(files.length / columns)) * SHEET_TILE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(tiles)
    .jpeg({ quality: 82 })
    .toFile(out);
}

type Flags = {
  search?: string;
  file?: string;
  category?: string;
  reason?: string;
  crop?: string;
  area?: string;
  kind?: string;
  /** The binomial of a species not yet in the catalog. */
  scientific?: string;
  limit?: number;
};

async function candidates(id: string, flags: Flags) {
  const subject = subjectFor(id, flags);
  const folder = subjectFolder(subject.id);
  const found = await gather(subject, flags);
  const dir = reviewDir(id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const kept: (Found & { n: number; highlights: number; sharpness: number })[] = [];
  const refused: { title: string; reason: string }[] = [];
  const sheet: { buffer: Buffer; label: string }[] = [];
  for (const candidate of found) {
    const early = refusal(candidate, folder);
    if (early) {
      refused.push({ title: candidate.title, reason: early });
      continue;
    }
    if (kept.length >= (flags.limit ?? 12)) break;
    await sleep(300);
    const buffer = Buffer.from(await (await polite(candidate.thumb)).arrayBuffer());
    const score = await measured(buffer);
    const late = refusal(candidate, folder, score);
    if (late) {
      refused.push({ title: candidate.title, reason: late });
      continue;
    }
    const n = kept.length + 1;
    kept.push({ ...candidate, n, ...score });
    sheet.push({ buffer, label: `${n} · ${candidate.via}` });
    await writeFile(path.join(dir, `${n}.jpg`), buffer);
  }
  await writeFile(
    path.join(dir, "candidates.json"),
    `${JSON.stringify({ subject: id, folder, kept, refused }, null, 2)}\n`,
  );
  for (const entry of refused) console.log(`  refused ${entry.title} — ${entry.reason}`);
  if (kept.length === 0) {
    console.log(`${id}: no candidate cleared the rules. Try --search or --file, or record none.`);
    return;
  }
  await contactSheet(sheet, path.join(dir, "sheet.jpg"));
  for (const entry of kept) {
    console.log(
      `  ${entry.n}. ${entry.title} · ${entry.licence} · ${entry.width}x${entry.height} · via ${entry.via}`,
    );
  }
  console.log(`${id}: ${kept.length} candidate(s) — look at ${path.relative(ROOT, dir)}/sheet.jpg`);
}

function bundledName(subject: Subject, title: string): string {
  if (subject.kind === "species") return `${subject.slug}.jpg`;
  return `${title
    .replace(/^File:/, "")
    .replace(/\.[a-z]+$/i, "")
    .replace(/[/\\?%*:|"<>]/g, "-")}.jpg`;
}

async function writeTiles(slug: string) {
  const source = path.join(PUBLIC, "marine-life", `${slug}.jpg`);
  for (const width of MARINE_LIFE_TILE_WIDTHS) {
    const dir = path.join(PUBLIC, "marine-life", "tiles", String(width));
    await mkdir(dir, { recursive: true });
    await sharp(source)
      .resize({ width })
      .jpeg({ quality: FOLDERS["marine-life"].quality, mozjpeg: true })
      .toFile(path.join(dir, `${slug}.jpg`));
  }
}

/** Where to download a chosen candidate at a size that still fills the bound after a crop. */
async function sourceUrl(chosen: { title: string; url: string; width: number }, bound: number) {
  // An iNaturalist original is at most 2048px, already the right order of size.
  if (chosen.title.startsWith("inaturalist:")) return chosen.url;
  // Commons' own downscale at twice the bound, so a crop still fills it.
  const sized = await api(API, {
    action: "query",
    titles: chosen.title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(Math.min(bound * 2, chosen.width)),
  });
  // biome-ignore lint/suspicious/noExplicitAny: a MediaWiki page object
  const info = (Object.values(sized.query.pages)[0] as any).imageinfo[0];
  return String(info.thumburl ?? info.url);
}

async function accept(id: string, pick: string, flags: Flags) {
  const subject = subjectFor(id, flags);
  const dir = reviewDir(id);
  const ledger = JSON.parse(await readFile(path.join(dir, "candidates.json"), "utf8"));
  const chosen = ledger.kept.find((entry: { n: number }) => entry.n === Number(pick));
  if (!chosen)
    throw new Error(`${id}: no candidate ${pick} on the last sheet; run candidates again`);
  const folder: PhotoFolder = ledger.folder;
  const { bound, quality } = FOLDERS[folder];
  const source = Buffer.from(await (await polite(await sourceUrl(chosen, bound))).arrayBuffer());
  let image = sharp(await sharp(source).rotate().toBuffer());
  let crop: string | undefined;
  if (flags.crop) {
    const [left, top, width, height] = flags.crop.split(",").map(Number);
    const meta = await image.metadata();
    const box = {
      left: Math.round((left ?? 0) * (meta.width ?? 0)),
      top: Math.round((top ?? 0) * (meta.height ?? 0)),
      width: Math.round((width ?? 1) * (meta.width ?? 0)),
      height: Math.round((height ?? 1) * (meta.height ?? 0)),
    };
    if (Math.max(box.width, box.height) < bound) {
      throw new Error(`${id}: that crop is ${box.width}x${box.height}, below the ${bound}px bound`);
    }
    image = image.extract(box);
    crop = `cropped to ${flags.crop} (left, top, width, height as fractions of the original)`;
  }
  const name = bundledName(subject, chosen.title);
  const file = `${folder}/${name}`;
  await image
    .resize({ width: bound, height: bound, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(path.join(PUBLIC, file));
  if (subject.kind === "species") await writeTiles(subject.slug);

  const records = await readPhotoRecords();
  for (const [existing, record] of Object.entries(records.photos)) {
    if (record.subject === id && existing !== file) {
      delete records.photos[existing];
      await rm(path.join(PUBLIC, existing), { force: true });
    }
  }
  delete records.unphotographed[id];
  records.photos[file] = {
    subject: id,
    source: chosen.title.startsWith("inaturalist:") ? chosen.descriptionUrl : chosen.title,
    licence: chosen.licence,
    artist: chosen.artist,
    sourceSize: [chosen.width, chosen.height],
    ...(crop ? { crop } : {}),
    reviewed: today(),
  };
  await writePhotoRecords(records);
  await writeReadmes(records);
  console.log(`${id}: ${file} · ${chosen.licence} · ${chosen.artist || "no artist named"}`);
}

async function none(id: string, flags: Flags) {
  const subject = subjectFor(id);
  if (subject.kind === "species") {
    throw new Error(`${id}: every species card needs a photo; try --search or --file instead`);
  }
  if (!flags.reason) throw new Error(`${id}: say why with --reason "…"`);
  const records = await readPhotoRecords();
  records.unphotographed[id] = { reason: flags.reason, checked: today() };
  await writePhotoRecords(records);
  console.log(`${id}: recorded as having no qualifying photo — ${flags.reason}`);
}

function todo(records: PhotoRecords, flags: Flags) {
  const lines: string[] = [];
  const bySubject = new Map(
    Object.values(records.photos).map((record) => [record.subject, record]),
  );
  if (!flags.kind || flags.kind === "species") {
    for (const species of MARINE_LIFE_CATALOG) {
      if (!bySubject.has(`species:${species.slug}`)) lines.push(`species:${species.slug}`);
    }
  }
  if (!flags.kind || flags.kind === "site") {
    for (const template of DIVE_SITE_TEMPLATES) {
      if (flags.area && template.area !== flags.area) continue;
      const id = `site:${template.slug}`;
      if (!bySubject.has(id) && !records.unphotographed[id]) lines.push(id);
    }
  }
  for (const [file, record] of Object.entries(records.photos)) {
    if (!record.reviewed) lines.push(`${record.subject}  (${file} not yet reviewed)`);
  }
  console.log(
    lines.length ? lines.join("\n") : "Nothing to do: every subject has a vetted record.",
  );
}

async function bundledFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const folder of Object.keys(FOLDERS)) {
    for (const entry of await readdir(path.join(PUBLIC, folder))) {
      if (entry.endsWith(".jpg")) files.push(`${folder}/${entry}`);
    }
  }
  return files.sort();
}

/** Records for bundled files that have none, filled in from Commons. Reviewed stays empty. */
async function adopt() {
  const records = await readPhotoRecords();
  const credits = await creditTitles();
  for (const file of await bundledFiles()) {
    if (records.photos[file]) continue;
    const title = credits.get(file);
    if (!title) {
      console.error(`${file}: no credit line names its Commons source; record it by hand`);
      continue;
    }
    const [found] = await filesByTitle([title], "adopted");
    if (!found) {
      console.error(`${file}: ${title} not found on Commons`);
      continue;
    }
    const folder = file.split("/")[0];
    const slug = path.basename(file, ".jpg");
    records.photos[file] = {
      subject: folder === "marine-life" ? `species:${slug}` : `seed:${slug}`,
      source: found.title,
      licence: found.licence,
      artist: found.artist,
      sourceSize: [found.width ?? 0, found.height ?? 0],
    };
    console.log(`${file}: ${found.title} · ${found.licence} · ${found.width}x${found.height}`);
  }
  await writePhotoRecords(records);
}

/** The Commons title each bundled file's existing credit line names. */
async function creditTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const marine = await readFile(path.join(PUBLIC, "marine-life", "README.md"), "utf8");
  for (const match of marine.matchAll(
    /^- `([a-z0-9-]+\.jpg)` — \[.*?\]\((https:\/\/commons\.wikimedia\.org\/wiki\/\S+?)\)(?: ·|$)/gm,
  )) {
    titles.set(`marine-life/${match[1]}`, commonsTitle(match[2] ?? ""));
  }
  const sites = await readFile(path.join(PUBLIC, "dive-sites", "README.md"), "utf8");
  for (const match of sites.matchAll(
    /^- \[.*?\]\((https:\/\/commons\.wikimedia\.org\/wiki\/\S+?)\)(:.*)?$/gm,
  )) {
    const title = commonsTitle(match[1] ?? "");
    const saved = [...(match[2] ?? "").matchAll(/`([^`]+\.jpg)`/g)].map((m) => m[1]);
    const names = saved.length
      ? saved
      : [`${title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "")}.jpg`];
    for (const name of names) titles.set(`dive-sites/${name}`, title);
  }
  return titles;
}

function commonsTitle(url: string) {
  return decodeURIComponent(url.replace(/^.*\/wiki\//, "")).replace(/_/g, " ");
}

/** Every bundled file against today's rules: licence, source size, description, picture. */
async function audit() {
  const records = await readPhotoRecords();
  let problems = 0;
  for (const file of await bundledFiles()) {
    const record = records.photos[file];
    if (!record) {
      console.log(`${file}: no record`);
      problems += 1;
      continue;
    }
    const folder = file.split("/")[0] as PhotoFolder;
    const score = await measured(await readFile(path.join(PUBLIC, file)));
    const problem = refusal(
      {
        title: record.source,
        licence: record.licence,
        width: record.sourceSize[0],
        height: record.sourceSize[1],
      },
      folder,
      score,
    );
    if (problem || !record.reviewed) {
      problems += 1;
      console.log(
        `${file}: ${problem ?? "not yet reviewed"} · ${record.subject} · highlights ${score.highlights} · sharpness ${score.sharpness.toFixed(1)}`,
      );
    }
  }
  console.log(
    problems ? `\n${problems} file(s) need work.` : "Every bundled file clears the rules.",
  );
}

async function sheetOf(files: string[]) {
  await mkdir(REVIEW, { recursive: true });
  const out = path.join(REVIEW, `bundled-${Date.now()}.jpg`);
  await contactSheet(
    await Promise.all(
      files.map(async (file, index) => ({
        buffer: await readFile(path.join(PUBLIC, file)),
        label: `${index + 1} · ${path.basename(file)}`,
      })),
    ),
    out,
  );
  console.log(path.relative(ROOT, out));
}

async function reviewed(files: string[]) {
  const records = await readPhotoRecords();
  for (const file of files) {
    const record = records.photos[file];
    if (!record) throw new Error(`${file}: no record; run adopt first`);
    record.reviewed = today();
  }
  await writePhotoRecords(records);
  console.log(`${files.length} file(s) marked reviewed ${today()}`);
}

async function writeReadmes(records: PhotoRecords) {
  for (const folder of Object.keys(FOLDERS) as PhotoFolder[]) {
    const readme = path.join(PUBLIC, folder, "README.md");
    const body = await readFile(readme, "utf8");
    await writeFile(readme, renderCredits(body, folder, records));
  }
}

async function tiles() {
  for (const species of MARINE_LIFE_CATALOG) {
    if (existsSync(path.join(PUBLIC, "marine-life", `${species.slug}.jpg`))) {
      await writeTiles(species.slug);
    }
  }
  console.log(`tiles re-derived at ${MARINE_LIFE_TILE_WIDTHS.join("/")}px`);
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    } else positional.push(arg);
  }
  return {
    positional,
    flags: { ...flags, limit: flags.limit ? Number(flags.limit) : undefined } as Flags,
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  switch (command) {
    case "todo":
      todo(await readPhotoRecords(), flags);
      break;
    case "candidates":
      for (const id of positional) await candidates(id, flags);
      break;
    case "accept":
      await accept(positional[0] ?? "", positional[1] ?? "", flags);
      break;
    case "none":
      for (const id of positional) await none(id, flags);
      break;
    case "audit":
      await audit();
      break;
    case "sheet":
      await sheetOf(positional);
      break;
    case "reviewed":
      await reviewed(positional);
      break;
    case "adopt":
      await adopt();
      break;
    case "readme":
      await writeReadmes(await readPhotoRecords());
      break;
    case "tiles":
      await tiles();
      break;
    default:
      console.error(
        `usage: pnpm content:photos <todo|candidates|accept|none|audit|sheet|reviewed|adopt|readme|tiles> …\nThe ledger is ${path.relative(ROOT, photoRecordsPath)}; the rules are src/content/photo-rules.ts.`,
      );
      process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
