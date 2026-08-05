import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { waiverTemplates } from "./schema";
import { at } from "./seed-clock";

/**
 * The release's own history.
 *
 * A waiver template is versioned by insertion, never by mutation (see
 * `waiverTemplates` in ./schema.ts): every edit staff make appends a version
 * and the newest one is what a freshly issued link snapshots. A shop that has
 * been trading for years is therefore never on version 1 — it is on whatever
 * number its counsel's last pass left it at, with the superseded wordings still
 * on file underneath, because a record signed against an older version has to
 * stay readable against the text it was actually signed against.
 *
 * The seed used to hand the demo shop a single version 1, which made the
 * template surface teach the opposite of that: one row, no history, "saved
 * today". This scenario restores the shape a real shop has — two superseded
 * wordings behind the current release — without changing what the current
 * release *says*: the newest row keeps its id, title and body
 * (`DEFAULT_WAIVER_BODY`), so every record snapshotted from it and every
 * currency check against `templateVersion` still line up. Only its version
 * number and the date it was saved move.
 *
 * **Runs first in `seedDemoSchedule`, before anything issues a waiver.**
 * `getCurrentWaiverTemplate` picks the newest row by `createdAt`, and every
 * later scenario (bookings, the month's other sailings, the cert-gate boats,
 * the history back-fill) snapshots whatever that returns. Moving this after any
 * of them would leave records claiming a version the shop is no longer on, and
 * `isCompletedWaiverCurrent` would read every one of them as signed against
 * superseded terms.
 */

/**
 * The wordings this shop has retired, oldest first. Deliberately shorter and
 * blunter than the release they were replaced by — this is what a shop's own
 * early paperwork reads like before a lawyer has been through it — and just as
 * deliberately *not* legal advice, the same caveat `DEFAULT_WAIVER_BODY`
 * carries.
 */
const SUPERSEDED_RELEASES: { body: string; createdAt: () => Date }[] = [
  {
    // The shop's original one-paragraph release, from before it ran courses.
    body: [
      "Release of Liability and Assumption of Risk",
      "",
      "I understand that scuba diving and boat travel carry risks, including changing sea conditions, equipment failure, marine life, and decompression illness, and that these risks can cause serious injury or death.",
      "",
      "I confirm I am fit to dive, that I will follow the crew's briefings and instructions, and that I will dive within the limits of my certification and experience.",
      "",
      "Knowing these risks, I accept them and release the dive shop, its staff, and the vessel from any claim arising from my participation.",
    ].join("\n"),
    createdAt: () => at(-430, 9),
  },
  {
    // The revision that added the health/impairment disclosure after the shop
    // started taking course students.
    body: [
      "Release of Liability, Waiver of Claims, and Assumption of Risk",
      "",
      "I understand that scuba diving, snorkeling, and boat travel carry inherent risks — including changing weather and sea conditions, boat and equipment handling, marine life, decompression illness, and barotrauma — and that these can lead to serious injury or death.",
      "",
      "I confirm that I am in good physical and mental condition to dive, that I am not diving under the influence of alcohol or drugs, and that I will tell the crew before departure if my health or certification changes.",
      "",
      "I agree to follow all briefings and instructions from the crew, to use the equipment as trained, and to end any dive I am not comfortable with.",
      "",
      "Knowing these risks, I voluntarily assume responsibility for them and release the dive shop, its staff, boat crew, and vessel from any claim arising from my participation.",
      "",
      "I have read this release in full, understand it, and agree to it freely.",
    ].join("\n"),
    createdAt: () => at(-183, 10),
  },
];

/** What version the demo shop's current release ends up on. */
export const DEMO_WAIVER_TEMPLATE_VERSION = SUPERSEDED_RELEASES.length + 1;

/** When the current release was last edited — the date the template page prints. */
const CURRENT_RELEASE_SAVED_AT = () => at(-16, 11);

export async function seedWaiverVersions(db: DbExecutor, shopId: string): Promise<void> {
  const existing = await db
    .select({ id: waiverTemplates.id, title: waiverTemplates.title })
    .from(waiverTemplates)
    .where(eq(waiverTemplates.shopId, shopId))
    .orderBy(asc(waiverTemplates.version));
  // The callers that reach here — `seedDemo`, `createDemoShop`, and
  // `resetDemoSchedule` — each leave exactly one freshly-inserted version 1
  // behind before calling `seedDemoSchedule`. Anything else means this shop has
  // already been versioned (or has a history a seed has no business rewriting),
  // so leave it alone rather than guess at a next version number.
  const [current] = existing;
  if (!current || existing.length !== 1) return;

  // The row keeps its id: records already pointing at it (there are none this
  // early, and that is the point — this runs before any link is issued) and
  // every later snapshot stay consistent with the shop's one live release.
  await db
    .update(waiverTemplates)
    .set({ version: DEMO_WAIVER_TEMPLATE_VERSION, createdAt: CURRENT_RELEASE_SAVED_AT() })
    .where(eq(waiverTemplates.id, current.id));

  await db.insert(waiverTemplates).values(
    SUPERSEDED_RELEASES.map((release, index) => ({
      shopId,
      // The title is immutable in the UI, so every version of a shop's release
      // carries the shop's own title — the canonical demo and a minted demo
      // seed different ones, and each keeps its own.
      title: current.title,
      version: index + 1,
      body: release.body,
      createdAt: release.createdAt(),
    })),
  );
}
