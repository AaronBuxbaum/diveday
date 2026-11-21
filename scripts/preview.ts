/**
 * `pnpm preview build <site-url | none> [--name …] [--color …] [--town …]
 * [--region …] [--tagline …]` and `pnpm preview list` — build a demo shop
 * dressed as one prospect and print the week-long link to send them, or read
 * what happened to every link (ADR 20261116-demo-previews).
 *
 * The product has no operator identity, so, like `billing:free-term`, this
 * runs against whatever database `getDb()` resolves: `DATABASE_URL` when set
 * (production, through `dotenv -c`), the dev PGlite directory otherwise.
 *
 * `build` requests the prospect's public home page once, from this machine,
 * and reads a name, a main colour and a town out of it
 * (`scripts/preview-site.ts`). Every flag wins over what the page says, and
 * `none` in place of the address skips the request. Nothing is sent to the
 * prospect: the command prints the link and the founder writes the email.
 */
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { demoPreviews } from "@/db/schema";
import { issuePreview, parsePreviewInput, previewPath } from "@/features/demo/demo-preview";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { readShopSite, type SiteFacts } from "./preview-site";

const USAGE = `Usage:
  pnpm preview build <site-url | none> [--name "Shop"] [--color "#0a5c8f"] [--town "Key Largo"] [--region "FL"] [--tagline "…"]
  pnpm preview list`;

const FLAGS = ["--name", "--color", "--town", "--region", "--tagline"] as const;
type Flag = (typeof FLAGS)[number];

export function parsePreviewArgs(
  argv: readonly string[],
):
  | { command: "list" }
  | { command: "build"; site: string | null; flags: Partial<Record<Flag, string>> }
  | null {
  const [command, site, ...rest] = argv;
  if (command === "list") return argv.length === 1 ? { command } : null;
  if (command !== "build" || !site || site.startsWith("--")) return null;
  const flags: Partial<Record<Flag, string>> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i] as Flag;
    const value = rest[i + 1];
    if (!FLAGS.includes(key) || !value || key in flags) return null;
    flags[key] = value;
  }
  if (site === "none") return { command, site: null, flags };
  const address = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  return URL.canParse(address) ? { command, site: address, flags } : null;
}

const NO_FACTS: SiteFacts = {
  name: null,
  brandColor: null,
  tagline: null,
  locality: null,
  region: null,
  latitude: null,
  longitude: null,
};

/** One request for one public page, as any browser would make it. A site that will not answer is not an error. */
async function fetchSite(site: string): Promise<SiteFacts> {
  try {
    const response = await fetch(site, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 (compatible; DiveDayPreview/1.0)",
      },
    });
    if (!response.ok) {
      console.warn(`The site answered ${response.status}. Building from the flags alone.`);
      return NO_FACTS;
    }
    return readShopSite((await response.text()).slice(0, 2_000_000));
  } catch {
    console.warn("The site could not be read. Building from the flags alone.");
    return NO_FACTS;
  }
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

async function build(site: string | null, flags: Partial<Record<Flag, string>>): Promise<number> {
  const facts = site ? await fetchSite(site) : NO_FACTS;
  const parsed = parsePreviewInput({
    name: flags["--name"] ?? facts.name ?? undefined,
    site: site ?? undefined,
    brandColor: flags["--color"] ?? facts.brandColor ?? undefined,
    tagline: flags["--tagline"] ?? facts.tagline ?? undefined,
    locality: flags["--town"] ?? facts.locality ?? undefined,
    region: flags["--region"] ?? facts.region ?? undefined,
    latitude: facts.latitude ?? undefined,
    longitude: facts.longitude ?? undefined,
  });
  if (!parsed.ok) {
    console.error(
      parsed.error === "invalid_color"
        ? 'The colour must be six hex digits, like "#0a5c8f".'
        : 'No shop name was found. Pass one with --name "Shop name".',
    );
    return 2;
  }
  const origin = publicAppUrl();
  if (!origin) {
    console.error("APP_HOST is not set, so there is no address to build the link on.");
    return 1;
  }
  const preview = await issuePreview(await getDb(), parsed.input);
  const { input } = parsed;
  console.log(`Built a preview for ${input.name}.`);
  console.log(`  colour  ${input.brandColor ?? "the demo's own"}`);
  console.log(
    `  town    ${[input.locality, input.region].filter(Boolean).join(", ") || "the demo's own"}`,
  );
  console.log(`  line    ${input.tagline ?? "the demo's own"}`);
  console.log(`  ends    ${when(preview.expiresAt)} UTC`);
  console.log(`\n${origin}${previewPath(preview.id)}\n`);
  console.log("Open it yourself first in a browser marked as yours, so your look is not counted.");
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parsePreviewArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  return args.command === "list" ? list() : build(args.site, args.flags);
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
