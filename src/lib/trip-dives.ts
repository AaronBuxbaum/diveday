import type { TripDiveDraft } from "@/db/trips";

/** Reads the ordered optional dive cards from a trip form. */
export function tripDiveDraftsFromForm(formData: FormData, count: number): TripDiveDraft[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const value = (name: string) => String(formData.get(`dive-${number}-${name}`) ?? "").trim();
    return {
      title: value("title") || null,
      diveSiteId: value("siteId") || null,
      description: value("description") || null,
    };
  });
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
