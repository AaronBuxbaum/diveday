import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoFolder } from "./photo-rules";

/**
 * **The photo ledger**: one record per photograph bundled under
 * `public/marine-life/` and `public/dive-sites/`, and one entry per subject
 * that was searched for and has no photograph worth bundling.
 *
 * `scripts/content-photos.ts` is the only writer. A record says where the
 * file came from (its Wikimedia Commons page, or its iNaturalist photo page), under what licence and by whom, how big
 * the original was (so the size rule can be re-checked without a download),
 * any crop, and the day a person looked at it and kept it. The credit lists in
 * both folders' READMEs are rendered from here, never typed.
 *
 * Subjects: `species:<catalog slug>`, `site:<template slug>` (a template's
 * cover), and `seed:<name>` for a demo-seed photograph a template does not own.
 */
export type PhotoRecord = {
  subject: string;
  /** The Commons file page title (`File:…`), or an iNaturalist photo page URL. */
  source: string;
  licence: string;
  artist: string;
  /** The original's width and height in pixels. */
  sourceSize: [number, number];
  /** How the bundled file was cut from the original, when it was. */
  crop?: string;
  /** The day a person looked at the file and kept it (YYYY-MM-DD). Absent until then. */
  reviewed?: string;
};

export type Unphotographed = { reason: string; checked: string };

export type PhotoRecords = {
  /** Keyed by the path under `public/`, e.g. `marine-life/blue-tang.jpg`. */
  photos: Record<string, PhotoRecord>;
  /** Keyed by subject. Only `site:` subjects may be here: every species card needs a photo. */
  unphotographed: Record<string, Unphotographed>;
};

export const photoRecordsPath = path.join(process.cwd(), "src", "content", "photo-records.json");

export async function readPhotoRecords(): Promise<PhotoRecords> {
  return JSON.parse(await readFile(photoRecordsPath, "utf8")) as PhotoRecords;
}

/** Sorted keys, two-space JSON, a trailing newline: a diff shows only what moved. */
export async function writePhotoRecords(records: PhotoRecords): Promise<void> {
  const sorted = <T>(object: Record<string, T>) =>
    Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    photoRecordsPath,
    `${JSON.stringify({ photos: sorted(records.photos), unphotographed: sorted(records.unphotographed) }, null, 2)}\n`,
  );
}

export function subjectFolder(subject: string): PhotoFolder {
  return subject.startsWith("species:") ? "marine-life" : "dive-sites";
}

export function commonsPageUrl(title: string): string {
  return `https://commons.wikimedia.org/wiki/${encodeURI(title.replace(/ /g, "_")).replace(/\?/g, "%3F")}`;
}

/** One README credit line for one bundled file. */
export function creditLine(file: string, record: PhotoRecord): string {
  const name = path.basename(file);
  const inaturalist = record.source.match(/^https:\/\/www\.inaturalist\.org\/photos\/(\d+)$/);
  if (inaturalist) {
    const artist = record.artist ? ` · ${record.artist.replace(/`/g, "")}` : "";
    const crop = record.crop ? ` · ${record.crop}` : "";
    return `- \`${name}\` — [iNaturalist photo ${inaturalist[1]}](${record.source}) · ${record.licence}${artist}${crop}`;
  }
  const title = record.source.replace(/^File:/, "");
  const artist = record.artist ? ` · ${record.artist.replace(/`/g, "")}` : "";
  const crop = record.crop ? ` · ${record.crop}` : "";
  return `- \`${name}\` — [${title}](${commonsPageUrl(record.source)}) · ${record.licence}${artist}${crop}`;
}

export const CREDITS_START = "<!-- credits:start (rendered by pnpm content:photos readme) -->";
export const CREDITS_END = "<!-- credits:end -->";

/** The README with its credit list replaced by the ledger's, between the two markers. */
export function renderCredits(readme: string, folder: PhotoFolder, records: PhotoRecords): string {
  const lines = Object.entries(records.photos)
    .filter(([file]) => file.startsWith(`${folder}/`))
    .sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map(([file, record]) => creditLine(file, record));
  const start = readme.indexOf(CREDITS_START);
  const end = readme.indexOf(CREDITS_END);
  if (start === -1 || end === -1) {
    throw new Error(`public/${folder}/README.md has no credit markers`);
  }
  return `${readme.slice(0, start + CREDITS_START.length)}\n\n${lines.join("\n")}\n\n${readme.slice(end)}`;
}
