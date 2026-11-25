/**
 * `pnpm preview build <site-url | none> [--name …] [--color …] [--town …]
 * [--region …] [--tagline …] [--times …] [--boats …]`, `pnpm preview batch
 * <file>` and `pnpm preview list` — build a demo shop dressed as one prospect
 * (or one per line of a file) and print the week-long link to send them, or
 * read what happened to every link (ADR 20261116-demo-previews).
 *
 * The product has no operator identity, so, like `billing:free-term`, this
 * runs against whatever database `getDb()` resolves: `DATABASE_URL` when set
 * (production, through `dotenv -c`), the dev PGlite directory otherwise.
 *
 * `build` requests the prospect's public home page and at most four of the
 * schedule or charter pages it links to, from this machine, and reads a name,
 * a main colour, a town, the times the boats leave and the boats' names out
 * of them (`scripts/preview-site.ts`). Every flag wins over what the pages
 * say, `none` in place of the address skips the requests, and `--times none`
 * or `--boats none` keeps the sample day's. Nothing is sent to the prospect:
 * the command prints the link and the founder writes the email.
 */
import { readFileSync } from "node:fs";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { demoPreviews } from "@/db/schema";
import {
  issuePreview,
  PREVIEW_MAX_BOATS,
  PREVIEW_MAX_DEPARTURES,
  parseDepartureTimes,
  parsePreviewInput,
  previewPath,
} from "@/features/demo/demo-preview";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { readShopSite, type SiteFacts, schedulePageLinks } from "./preview-site";

const USAGE = `Usage:
  pnpm preview build <site-url | none> [--name "Shop"] [--color "#0a5c8f"] [--town "Key Largo"] [--region "FL"] [--tagline "…"] [--times "8:30 AM, 1:00 PM"] [--boats "Reef Runner, Sea Hunter"]
  pnpm preview batch <file>    (one shop per line, written as after "pnpm preview build")
  pnpm preview list`;

const FLAGS = [
  "--name",
  "--color",
  "--town",
  "--region",
  "--tagline",
  "--times",
  "--boats",
] as const;
type Flag = (typeof FLAGS)[number];
type Flags = Partial<Record<Flag, string>>;

export function parsePreviewArgs(
  argv: readonly string[],
):
  | { command: "list" }
  | { command: "batch"; file: string }
  | { command: "build"; site: string | null; flags: Flags }
  | null {
  const [command, site, ...rest] = argv;
  if (command === "list") return argv.length === 1 ? { command } : null;
  if (command === "batch") return argv.length === 2 && site ? { command, file: site } : null;
  if (command !== "build" || !site || site.startsWith("--")) return null;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i] as Flag;
    const value = rest[i + 1];
    if (!FLAGS.includes(key) || !value || key in flags) return null;
    if (key === "--times" && value !== "none" && !parseDepartureTimes(value)?.length) return null;
    flags[key] = value;
  }
  if (site === "none") return { command, site: null, flags };
  const address = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  return URL.canParse(address) ? { command, site: address, flags } : null;
}

/**
 * One line of a batch file as the words after `pnpm preview build`: split on
 * spaces, with "double" or 'single' quotes holding a value together. Null
 * for an unclosed quote. A blank line or a `#` comment is no words.
 */
export function batchLineWords(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return [];
  const words: string[] = [];
  let word: string | null = null;
  let quote: string | null = null;
  for (const char of trimmed) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= "";
    } else if (/\s/.test(char)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? "") + char;
  }
  if (quote) return null;
  if (word !== null) words.push(word);
  return words;
}

const NO_FACTS: SiteFacts = {
  name: null,
  brandColor: null,
  tagline: null,
  locality: null,
  region: null,
  latitude: null,
  longitude: null,
  departureTimes: [],
  boatNames: [],
};

/** One request for one public page, as any browser would make it: its address after redirects and its HTML, or null. */
async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 (compatible; DiveDayPreview/1.0)",
      },
    });
    if (!response.ok) return null;
    return { url: response.url || url, html: (await response.text()).slice(0, 2_000_000) };
  } catch {
    return null;
  }
}

/** The home page and the schedule pages it links to. A site that will not answer is not an error. */
async function fetchSite(site: string): Promise<SiteFacts> {
  const home = await fetchPage(site);
  if (!home) {
    console.warn("The site could not be read. Building from the flags alone.");
    return NO_FACTS;
  }
  const more: string[] = [];
  for (const link of schedulePageLinks(home.html, home.url)) {
    const page = await fetchPage(link);
    if (page) more.push(page.html);
  }
  return readShopSite(home.html, more);
}

/** "08:30" as the founder reads it: "8:30 AM". */
function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function listFlag(value: string | undefined, found: string[]): string[] {
  if (value === "none") return [];
  if (value === undefined) return found;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function when(at: Date | null): string {
  return at ? at.toISOString().slice(0, 16).replace("T", " ") : "never";
}

async function list(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(demoPreviews)
    // diveday:allow-time-id-order: the founder's reading list, newest first; the id makes it total.
    .orderBy(desc(demoPreviews.createdAt), desc(demoPreviews.id))
    .limit(200);
  if (rows.length === 0) {
    console.log("No previews yet.");
    return 0;
  }
  const origin = publicAppUrl() ?? "";
  const now = Date.now();
  for (const row of rows) {
    const state = row.expiresAt.getTime() > now ? `open until ${when(row.expiresAt)}` : "ended";
    console.log(`${row.prospectName}  (${state}, times in UTC)`);
    console.log(`  link      ${origin}${previewPath(row.id)}`);
    console.log(
      `  requested ${row.fetchCount}  (mail scanners count here; first ${when(row.firstFetchedAt)})`,
    );
    console.log(
      `  opened    ${row.openCount}  (a browser entered the shop; first ${when(row.firstOpenedAt)})`,
    );
    console.log(
      `  used      ${row.activeCount}  (a person typed or tapped inside; last ${when(row.lastActiveAt)})`,
    );
  }
  return 0;
}

type Built = { ok: true; name: string; link: string } | { ok: false; code: number };

async function build(site: string | null, flags: Flags): Promise<Built> {
  const facts = site ? await fetchSite(site) : NO_FACTS;
  const times =
    flags["--times"] === "none"
      ? []
      : flags["--times"]
        ? (parseDepartureTimes(flags["--times"]) ?? [])
        : facts.departureTimes;
  const boats = listFlag(flags["--boats"], facts.boatNames);
  if (times.length > PREVIEW_MAX_DEPARTURES) {
    console.warn(`Only the first ${PREVIEW_MAX_DEPARTURES} departure times are used.`);
  }
  if (boats.length > PREVIEW_MAX_BOATS) {
    console.warn(
      `The demo has ${PREVIEW_MAX_BOATS} boats, so only the first ${PREVIEW_MAX_BOATS} names are used.`,
    );
  }
  const parsed = parsePreviewInput({
    name: flags["--name"] ?? facts.name ?? undefined,
    site: site ?? undefined,
    brandColor: flags["--color"] ?? facts.brandColor ?? undefined,
    tagline: flags["--tagline"] ?? facts.tagline ?? undefined,
    locality: flags["--town"] ?? facts.locality ?? undefined,
    region: flags["--region"] ?? facts.region ?? undefined,
    latitude: facts.latitude ?? undefined,
    longitude: facts.longitude ?? undefined,
    departureTimes: times.slice(0, PREVIEW_MAX_DEPARTURES),
    boatNames: boats.slice(0, PREVIEW_MAX_BOATS),
  });
  if (!parsed.ok) {
    console.error(
      parsed.error === "invalid_color"
        ? 'The colour must be six hex digits, like "#0a5c8f".'
        : parsed.error === "invalid_times"
          ? 'Departure times look like "8:30 AM, 1:00 PM".'
          : 'No shop name was found. Pass one with --name "Shop name".',
    );
    return { ok: false, code: 2 };
  }
  const origin = publicAppUrl();
  if (!origin) {
    console.error("APP_HOST is not set, so there is no address to build the link on.");
    return { ok: false, code: 1 };
  }
  const preview = await issuePreview(await getDb(), parsed.input);
  const { input } = parsed;
  console.log(`Built a preview for ${input.name}.`);
  console.log(`  colour  ${input.brandColor ?? "the demo's own"}`);
  console.log(
    `  town    ${[input.locality, input.region].filter(Boolean).join(", ") || "the demo's own"}`,
  );
  console.log(`  line    ${input.tagline ?? "the demo's own"}`);
  console.log(
    `  boats   ${input.departureTimes.length ? input.departureTimes.map(clock).join(", ") : "the demo's own times"}`,
  );
  console.log(
    `  names   ${input.boatNames.length ? input.boatNames.join(", ") : "the demo's own"}`,
  );
  console.log(`  ends    ${when(preview.expiresAt)} UTC`);
  const link = `${origin}${previewPath(preview.id)}`;
  console.log(`\n${link}\n`);
  return { ok: true, name: input.name, link };
}

const OPEN_FIRST =
  "Open each link yourself first in a browser marked as yours, so your look is not counted.";

/**
 * Every line of the file is checked before anything is built, so a typo on
 * line six does not leave five previews behind it. Then each shop is built in
 * turn; one that cannot be built is said and skipped, and the links are
 * printed together at the end beside the shops' names.
 */
async function batch(file: string): Promise<number> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`${file} could not be read.`);
    return 2;
  }
  const shops: { line: number; site: string | null; flags: Flags }[] = [];
  const wrong: number[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const words = batchLineWords(line);
    if (words?.length === 0) continue;
    const args = words ? parsePreviewArgs(["build", ...words]) : null;
    if (args?.command === "build") shops.push({ line: index + 1, ...args });
    else wrong.push(index + 1);
  }
  if (wrong.length > 0) {
    console.error(`Nothing was built. These lines could not be read: ${wrong.join(", ")}.`);
    console.error(USAGE);
    return 2;
  }
  if (shops.length === 0) {
    console.error(`${file} names no shop.`);
    return 2;
  }
  const built: { name: string; link: string }[] = [];
  const skipped: number[] = [];
  for (const shop of shops) {
    console.log(`Line ${shop.line}: ${shop.site ?? shop.flags["--name"] ?? ""}`);
    const result = await build(shop.site, shop.flags);
    if (result.ok) built.push(result);
    else skipped.push(shop.line);
  }
  console.log(`Built ${built.length} of ${shops.length}.\n`);
  for (const { name, link } of built) console.log(`${name}\n${link}\n`);
  if (skipped.length > 0) console.log(`Not built, see above: line ${skipped.join(", line ")}.`);
  console.log(OPEN_FIRST);
  return skipped.length > 0 ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parsePreviewArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  if (args.command === "list") return list();
  if (args.command === "batch") return batch(args.file);
  const result = await build(args.site, args.flags);
  if (!result.ok) return result.code;
  console.log(OPEN_FIRST);
  return 0;
}

// tsx imports its entry module, so import.meta.main is undefined there.
if (process.argv[1]?.endsWith("preview.ts")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
