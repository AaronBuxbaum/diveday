// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see the doc comment

/**
 * DiveDay's published dive-site catalog: real places, written up as a briefing
 * a shop can import and then make its own.
 *
 * **One file per dive area** (`./dive-areas.ts`), under `./dive-sites/`, and
 * this barrel joins them. An area is the grain of the catalog's promise: its
 * denominator in `./coverage/<area>.json` lists the named sites shops there
 * run, and `pnpm content:coverage` says how many of them are defined here.
 * Every template cites the public sources its facts were checked against.
 *
 * **These are starting words, not app copy** — the same contract
 * `./course-templates.ts` and `./marine-life-catalog.ts` have, and the reason
 * this file is exempt from the message-bundle rule. Importing copies the whole
 * briefing into the shop's own row (`importGlobalDiveSiteTemplate`), where the
 * shop rewrites whatever it likes in its own language. Nothing here is read
 * again afterwards, so publishing a correction never overwrites what a shop
 * put on its own page.
 *
 * **What the numbers mean.** Coordinates are the published position of the site
 * — a lighthouse, a sanctuary marker, a wreck's recorded resting place, a
 * spring's own mouth — accurate enough to centre a map and read a forecast at,
 * and *not* a mooring assignment: a shop confirms its own buoy and edits the
 * point. Depths are the site's real published range; the `maxDepthMeters` is
 * what a certification ceiling gets compared against (H-08), so it is the
 * deepest point a diver can reach on or off the briefed plan (a deeper mooring
 * included), capped where the structure itself passes recreational limits, and
 * never the depth a typical dive runs to. A wreck whose sand is deeper says so in
 * its prose.
 *
 * **Prose measures are written in metres and land in the shop's unit.** "About
 * 12 m" in a landmark arrives in a feet shop's copy as "about 39 ft", and an
 * authored pair, "18–40 m (60–130 ft)", as the shop's half
 * (`briefingInUnit`, src/lib/site-prose-units.ts, at import and in the
 * template-update merge). Write a measure as a number and its symbol; a pair
 * when the published sources give both.
 *
 * **Certification gates are the conservative reading.** A wreck below 30 m
 * carries Advanced Open Water and the Deep specialty because that is what its
 * depth demands of a diver in open water — never because penetration is
 * implied, which is a different card and a different dive. A shop that runs a
 * site differently edits the gate; nothing here is the last word, and the trip
 * composes the stricter of the two anyway (`src/lib/readiness.ts`).
 */
export type { DiveSiteTemplate } from "./dive-sites/types";

import { FLORIDA_BROWARD } from "./dive-sites/florida-broward";
import { FLORIDA_GULF_COAST } from "./dive-sites/florida-gulf-coast";
import { FLORIDA_KEYS_ISLAMORADA } from "./dive-sites/florida-keys-islamorada";
import { FLORIDA_KEYS_KEY_WEST } from "./dive-sites/florida-keys-key-west";
import { FLORIDA_KEYS_LOWER } from "./dive-sites/florida-keys-lower";
import { FLORIDA_KEYS_MARATHON } from "./dive-sites/florida-keys-marathon";
import { FLORIDA_KEYS_UPPER } from "./dive-sites/florida-keys-upper";
import { FLORIDA_MIAMI } from "./dive-sites/florida-miami";
import { FLORIDA_PALM_BEACH } from "./dive-sites/florida-palm-beach";
import { FLORIDA_PANHANDLE } from "./dive-sites/florida-panhandle";
import { FLORIDA_SPRINGS } from "./dive-sites/florida-springs";
import type { DiveSiteTemplate } from "./dive-sites/types";
import ledger from "./photo-records.json";

/**
 * Each template's cover, from the photo ledger rather than written into the
 * template: `pnpm content:photos accept site:<slug> <n>` is the only way a
 * cover arrives, so the ledger is the one place it is recorded. A template
 * that gains a cover after it was published reaches a database that already
 * holds it only with a `version` bump, like any other correction.
 */
const COVER_BY_SLUG = new Map(
  Object.entries(ledger.photos as Record<string, { subject: string }>)
    .filter(([, record]) => record.subject.startsWith("site:"))
    .map(([file, record]) => [
      record.subject.slice("site:".length),
      `/dive-sites/${encodeURIComponent(file.slice("dive-sites/".length))}`,
    ]),
);

function withCover(template: DiveSiteTemplate): DiveSiteTemplate {
  const cover = COVER_BY_SLUG.get(template.slug);
  if (!cover) return template;
  return {
    ...template,
    briefing: { ...template.briefing, imageUrls: [cover, ...(template.briefing.imageUrls ?? [])] },
  };
}

export const DIVE_SITE_TEMPLATES: readonly DiveSiteTemplate[] = [
  ...FLORIDA_KEYS_UPPER,
  ...FLORIDA_KEYS_ISLAMORADA,
  ...FLORIDA_KEYS_MARATHON,
  ...FLORIDA_KEYS_LOWER,
  ...FLORIDA_KEYS_KEY_WEST,
  ...FLORIDA_PALM_BEACH,
  ...FLORIDA_BROWARD,
  ...FLORIDA_MIAMI,
  ...FLORIDA_PANHANDLE,
  ...FLORIDA_GULF_COAST,
  ...FLORIDA_SPRINGS,
].map(withCover);
