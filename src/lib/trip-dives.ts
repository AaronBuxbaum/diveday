import type { TripDiveDraft } from "@/db/trips";
import { DOCK_DAY_LIMITS } from "@/lib/diver-planning";

/**
 * A leg's stated minutes, or null for "the shop's ride-out figure is right".
 *
 * Null rather than a refusal for anything outside the bounds the box already
 * enforces: a leg is one optional hint among a card of optional hints, and
 * losing a whole departure's edit because a forged post carried `travel=9999`
 * would be a worse answer than falling back to the number the day used before
 * anybody typed. The table's CHECK constraint is what makes that safe — it
 * would refuse the write, so this never hands one down.
 */
function travelMinutesFromForm(raw: string): number | null {
  if (!raw) return null;
  const minutes = Number(raw);
  const { min, max } = DOCK_DAY_LIMITS.boatRideMinutes;
  return Number.isInteger(minutes) && minutes >= min && minutes <= max ? minutes : null;
}

/** Reads the ordered optional dive cards from a trip form. */
export function tripDiveDraftsFromForm(formData: FormData, count: number): TripDiveDraft[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const value = (name: string) => String(formData.get(`dive-${number}-${name}`) ?? "").trim();
    return {
      title: value("title") || null,
      diveSiteId: value("siteId") || null,
      description: value("description") || null,
      travelMinutes: travelMinutesFromForm(value("travelMinutes")),
    };
  });
}

/**
 * Did the staffer actually fill the per-dive cards in?
 *
 * The cards only exist in the DOM while the "More options" panel is expanded,
 * so a form posted with the panel closed reads as a full set of blank drafts —
 * and writing those over a departure would erase the quick row's single
 * dive-site select. The caller therefore needs to tell "blank because it was
 * never on screen" from "blank because that is what they typed", and this is
 * that test.
 *
 * Every optional field counts, `travelMinutes` included: a staffer whose only
 * per-dive edit is "ten minutes out to the house reef, then a long run across
 * to the wall" has filled the cards in, and omitting that field threw the
 * whole departure's timeline away as though the panel had never been opened.
 * `0` is a stated leg (the same site twice, a shore entry), so the check is
 * for presence rather than truthiness.
 */
export function hasTripDiveContent(drafts: readonly TripDiveDraft[]): boolean {
  return drafts.some(
    (draft) =>
      Boolean(draft.title || draft.diveSiteId || draft.description) || draft.travelMinutes !== null,
  );
}

/**
 * One planned dive of a departure, reduced to the two facts every "where does
 * this trip go" surface needs: which tank it is, and which site it visits.
 */
export type TripDiveSiteRef = {
  diveNumber: number;
  site: { id: string; name: string } | null;
};

/**
 * Where a departure actually goes, composed from its dives.
 *
 * `trips.dive_site_id` is only dive one's site copied onto the trip row, so a
 * surface that reads it names one site for a two-site day and names *none* on
 * the day whose undecided tank happens to be the first one. Every surface that
 * answers "where does this trip go" composes this instead.
 *
 * Sites are distinct and in dive order: a two-tank day that dives the same site
 * twice visits one site, not two. `undecidedDives` is the other half of the
 * answer and the reason this type exists at all — "one site, two dives" is a
 * legitimate published plan (the crew picks the second tank at the dock), and
 * without the count it reads as a discrepancy rather than as a plan.
 */
export type TripDiveSiteSummary = {
  sites: Array<{ id: string; name: string }>;
  undecidedDives: number;
};

export function summarizeTripDiveSites(dives: readonly TripDiveSiteRef[]): TripDiveSiteSummary {
  // Sorted here rather than trusted from the caller: the number a diver reads
  // ("Dive 2") is the dive number, so the order sites are listed in must follow
  // it even when a query returned the rows some other way.
  const ordered = [...dives].sort((a, b) => a.diveNumber - b.diveNumber);
  const seen = new Set<string>();
  const sites: Array<{ id: string; name: string }> = [];
  let undecidedDives = 0;
  for (const dive of ordered) {
    if (!dive.site) {
      undecidedDives += 1;
      continue;
    }
    if (seen.has(dive.site.id)) continue;
    seen.add(dive.site.id);
    sites.push({ id: dive.site.id, name: dive.site.name });
  }
  return { sites, undecidedDives };
}
