import { seenSiteFor } from "@/lib/sightings";

/**
 * **The records Wrapped up points to** (issue #4683): what the crew saw and
 * what was left aboard, each a short row that opens the record where it is
 * kept. Recording stays where it is (the Seen group on Roll call, Left aboard
 * under More); these only say there is something to read. Codes and counts;
 * the page says them, and a record with nothing in it is no row.
 */
export type WrappedRecords = {
  /** Species the crew logged, and the first dive whose Roll call holds them (null: none placed). */
  seen: { species: number; dive: number | null } | null;
  /** Items found aboard this departure. */
  leftAboard: { count: number } | null;
};

export function wrappedRecords({
  sightingsOn,
  sightings,
  dives,
  lostFoundOn,
  lostItems,
}: {
  sightingsOn: boolean;
  sightings: readonly {
    diveSiteId: string | null;
    speciesSlug: string;
    customName: string | null;
  }[];
  /** Each planned or recorded dive's site, the way Roll call's Seen group places its taps. */
  dives: readonly {
    diveNumber: number;
    recorded: { actualSite: { id: string } | null } | undefined;
    planned: { id: string } | null;
  }[];
  lostFoundOn: boolean;
  lostItems: readonly unknown[];
}): WrappedRecords {
  const species = new Set(sightings.map((row) => row.customName ?? row.speciesSlug)).size;
  const sited = new Set(sightings.map((row) => row.diveSiteId));
  const dive =
    [...dives]
      .sort((a, b) => a.diveNumber - b.diveNumber)
      .find((entry) => {
        const site = seenSiteFor({ recorded: entry.recorded, planned: entry.planned });
        return site !== null && sited.has(site.id);
      })?.diveNumber ?? null;
  return {
    seen: sightingsOn && species > 0 ? { species, dive } : null,
    leftAboard: lostFoundOn && lostItems.length > 0 ? { count: lostItems.length } : null,
  };
}
