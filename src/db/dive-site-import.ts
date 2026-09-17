import { and, eq, isNull } from "drizzle-orm";
import type { CertificationLevel } from "@/lib/certification-levels";
import type { PreparedDiveSiteImport, PreparedDiveSiteImportRow } from "@/lib/dive-site-import";
import type { AppDb } from "./client";
import {
  createDiveSite,
  type DiveSiteInput,
  refusingNameClash,
  SITE_NAME_TAKEN,
  updateDiveSite,
} from "./dive-sites";
import type { DiveSiteFitTone, DiveSpecialty } from "./schema";
import { certificationLevel, diveSiteFitTone, diveSites, diveSpecialty } from "./schema";

export type DiveSiteImportSummary = {
  created: number;
  updated: number;
  /** Rows the parser or this writer refused, with the row numbers a spreadsheet shows. */
  skipped: { rowNumber: number; issues: string[] }[];
  /**
   * Sites restored still deleted, counted separately because it is the one
   * outcome a staffer will not see on the library page afterwards and would
   * otherwise read as a row that failed silently.
   */
  deleted: number;
};

/**
 * **Reading a shop's own `dive_sites.csv` back into its library** (issue #1771).
 *
 * The export bundled thirty-eight columns of dive site and three comments
 * around it described a shop exporting and re-importing, while nothing in the
 * tree could read one back. This is that half.
 *
 * **It writes through `createDiveSite` and `updateDiveSite` rather than
 * touching the table**, which is the whole of its design. Those two own rules a
 * restore must not be able to skip, and every one of them was written for a
 * caller exactly like this: `confirmedStationWrite` grants a tide
 * acknowledgement only for the station id the stored row already holds
 * (issue #1731), `availableSiteSlug` mints a segment unique among this shop's
 * live sites, `planningNoteWrite` moves the note's stamp only when its words
 * move (issue #1204), and the row version bumps so an editor open in another
 * tab is refused rather than reverted. `DiveSiteInput`'s own docblocks already
 * say "the CSV import" in three places; this is the caller they were written
 * for.
 *
 * ## What a row matches
 *
 * Its `id` among **this shop's** rows first, then its `name`. Never the id as
 * written: a supplied primary key is a shop choosing a uuid, and a bundle
 * carried into a different shop would drag the old one across a tenant
 * boundary for nothing. So the id is a *key*, and a row whose id belongs to
 * nobody here falls to the name — which is what makes the same file restore
 * into the shop it came from (ids match, everything updates in place) and into
 * a fresh one (ids match nothing, names do the work, deleted sites come back
 * deleted).
 *
 * Matching on name includes deleted sites, because `(shop_id, name)` is unique
 * over all of them: a restore that ignored the deleted row would be refused by
 * the index rather than creating a second site.
 *
 * ## What it does not restore, and why each one
 *
 * - **`id`, `slug`, `created_at`, `row_version`** — DiveDay's bookkeeping. A
 *   slug is minted from the name because two libraries can collide on one, and
 *   `created_at` is when DiveDay first saw the row rather than anything the
 *   shop owns.
 * - **The field guide's species.** They are `dive_site_creatures.csv`, a file
 *   of its own with its own round trip, and `DiveSiteInput.creatures` left
 *   undefined is what "this caller does not manage them" means — so an existing
 *   site keeps the guide it has rather than being emptied. A restored site
 *   arrives without one. Filed rather than half-built.
 * - **`planning_note_at` and `planning_note_by_person_id`.** The words are
 *   restored; the stamp is `planningNoteWrite`'s, and it attributes the note to
 *   whoever ran the import. Carrying a person id from a bundle would either
 *   point at a stranger's row or at nothing.
 */
export async function commitDiveSiteImport(
  db: AppDb,
  shopId: string,
  prepared: PreparedDiveSiteImport,
  importedByPersonId: string,
): Promise<DiveSiteImportSummary> {
  const summary: DiveSiteImportSummary = { created: 0, updated: 0, skipped: [], deleted: 0 };
  if (prepared.fatal) return summary;

  // One read of the library up front rather than two probes per row: a bundle
  // is the whole library, so the per-row reads would be the same table scanned
  // once per site it contains.
  const existing = await db
    .select({ id: diveSites.id, name: diveSites.name, deletedAt: diveSites.deletedAt })
    .from(diveSites)
    .where(eq(diveSites.shopId, shopId));
  const byId = new Map(existing.map((row) => [row.id, row] as const));
  const byName = new Map(existing.map((row) => [row.name, row] as const));
  // Two rows in one file naming the same site would otherwise have the second
  // update what the first created and report both, which reads as two sites.
  const claimed = new Set<string>();

  for (const row of prepared.rows) {
    if (row.issues.length > 0) {
      summary.skipped.push({ rowNumber: row.rowNumber, issues: row.issues });
      continue;
    }
    const match = (row.sourceId ? byId.get(row.sourceId) : undefined) ?? byName.get(row.name);
    if (match && claimed.has(match.id)) {
      summary.skipped.push({ rowNumber: row.rowNumber, issues: ["duplicate_in_file"] });
      continue;
    }
    const input = diveSiteInput(shopId, row, importedByPersonId, Boolean(match));
    if (match) {
      // **Both refusals the writer can hand back, and neither used to be
      // read** (security review, issue #1771). `updateDiveSite` carries
      // `deleted_at is null`, so a row matching a *deleted* site by name
      // matched nothing and wrote nothing — and this counted it as updated,
      // then `applyDeletedState` counted it as deleted. "1 updated, 1 deleted"
      // over a library that had not changed at all, on exactly the scenario
      // the name match exists for.
      const updated = await refusingNameClash(() => updateDiveSite(db, shopId, match.id, input));
      if (updated === SITE_NAME_TAKEN) {
        summary.skipped.push({ rowNumber: row.rowNumber, issues: ["name_taken"] });
        continue;
      }
      if (!updated) {
        summary.skipped.push({ rowNumber: row.rowNumber, issues: ["not_written"] });
        continue;
      }
      summary.updated += 1;
      claimed.add(match.id);
      await applyDeletedState(db, shopId, match.id, row, summary);
      continue;
    }
    // A concurrent save can take the name between the read above and this
    // write. Unhandled that is a 500 out of the server action with N sites
    // already committed and no summary to show for them, which is the worst
    // shape this can fail in; `refusingNameClash` turns it into one skipped row.
    const created = await refusingNameClash(() => createDiveSite(db, input));
    if (created === SITE_NAME_TAKEN) {
      summary.skipped.push({ rowNumber: row.rowNumber, issues: ["name_taken"] });
      continue;
    }
    if (!created) {
      summary.skipped.push({ rowNumber: row.rowNumber, issues: ["not_written"] });
      continue;
    }
    summary.created += 1;
    claimed.add(created.id);
    byId.set(created.id, { id: created.id, name: created.name, deletedAt: null });
    byName.set(created.name, { id: created.id, name: created.name, deletedAt: null });
    await applyDeletedState(db, shopId, created.id, row, summary);
  }

  return summary;
}

/**
 * **A deleted site comes back deleted.** `deleted_at` is not on
 * `DiveSiteInput` — no editor writes it, and it should stay that way — so it is
 * a second statement rather than a field. A shop restoring its library gets the
 * library it had, including the sites it had taken off the board; putting them
 * all back live would republish briefings the shop retired, on public pages,
 * without anyone asking.
 *
 * One direction only, and for the delete rule's own reason: a bundle that says
 * nothing about a live site leaves it live, because restoring one is a staffer
 * pointing at a row and asking.
 */
async function applyDeletedState(
  db: AppDb,
  shopId: string,
  siteId: string,
  row: PreparedDiveSiteImportRow,
  summary: DiveSiteImportSummary,
): Promise<void> {
  if (!row.deletedAt) return;
  const deletedAt = new Date(row.deletedAt);
  await db
    .update(diveSites)
    .set({ deletedAt })
    .where(
      and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)),
    );
  summary.deleted += 1;
}

function member<T extends string>(value: string | null, allowed: readonly string[]): T | null {
  return value !== null && allowed.includes(value) ? (value as T) : null;
}

/**
 * The CSV row as the writers' own input.
 *
 * Every code column is matched against the enum the column is actually declared
 * with rather than a list written out here — a word the database would refuse
 * is dropped to null, so one unrecognised certification level costs that site
 * its cert line and not the whole restore. The alternative is a 23514 out of a
 * transaction that has already written six sites.
 */
function diveSiteInput(
  shopId: string,
  row: PreparedDiveSiteImportRow,
  importedByPersonId: string,
  matchedAnExistingSite: boolean,
): DiveSiteInput {
  return {
    shopId,
    name: row.name,
    description: row.description ?? undefined,
    locationName: row.locationName ?? undefined,
    forecastLatitude: row.forecastLatitude,
    forecastLongitude: row.forecastLongitude,
    tideStationId: row.tideStationId,
    // **Claimed by the file; granted only where there is a pairing to compare
    // against** (issue #1731, and #1771 asked for exactly this).
    //
    // On an update `confirmedStationWrite` does the work: the tick lands only
    // if the stored row still holds this station id. On an **insert** it does
    // not — `createDiveSite` honours the tick whenever a station comes with it,
    // and that is right for the editor it was written for, where the staffer
    // posting the id and the tick in one submission *is* the acknowledgement.
    // A CSV is not a staffer looking at a map. A row carrying `true` beside a
    // station this shop has never held is a claim nobody here has checked, so
    // it lands false and the editor's distance prompt renders once, which is
    // the whole point of the column.
    tideStationConfirmed: matchedAnExistingSite && row.tideStationConfirmed,
    tidePreference: row.tidePreference ?? "any",
    satelliteImageUrl: row.satelliteImageUrl ?? undefined,
    routeImageUrl: row.routeImageUrl ?? undefined,
    imageUrls: row.imageUrls ?? undefined,
    marineLife: row.marineLife ?? undefined,
    marineLifeDescription: row.marineLifeDescription ?? undefined,
    difficultyLevel: row.difficultyLevel,
    depthRange: row.depthRange ?? undefined,
    maxDepthMeters: row.maxDepthMeters,
    expectedBottomTimeMinutes: row.expectedBottomTimeMinutes,
    currentNote: row.currentNote ?? undefined,
    divePlan: row.divePlan ?? undefined,
    conservationNote: row.conservationNote ?? undefined,
    fitTone: member<DiveSiteFitTone>(row.fitTone, diveSiteFitTone.enumValues),
    fitNote: row.fitNote ?? undefined,
    fieldGuideTipsHeading: row.fieldGuideTipsHeading ?? undefined,
    landmarks: row.landmarks ?? undefined,
    minimumCertificationLevel: member<CertificationLevel>(
      row.minimumCertificationLevel,
      certificationLevel.enumValues,
    ),
    requiredSpecialties: (row.requiredSpecialties ?? []).filter((code): code is DiveSpecialty =>
      (diveSpecialty.enumValues as readonly string[]).includes(code),
    ),
    requiresNitrox: row.requiresNitrox ?? false,
    routePoints: row.routePoints ?? undefined,
    routeLabel: row.routeLabel ?? undefined,
    routeNote: row.routeNote ?? undefined,
    routeZoom: row.routeZoom ?? undefined,
    planningNote: row.planningNote
      ? { words: row.planningNote, byPersonId: importedByPersonId }
      : undefined,
  };
}
