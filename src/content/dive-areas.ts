/**
 * **Dive areas**: the named stretches of coast DiveDay's dive-site catalog is
 * organised by, and the unit its coverage is measured in.
 *
 * Every template in `./dive-sites/` names one area. An area carries two
 * things a template alone cannot:
 *
 * - **Where it is, as an address would say it** — an ISO 3166 country and,
 *   where one country holds several areas or other places a shop could be, a
 *   subdivision. That is what decides whether the catalog is near a shop
 *   (`catalogAreasForShop` in `src/lib/curated-defaults.ts`): a shop's
 *   address is matched against it, never its timezone alone (issue #2477).
 * - **A denominator.** `src/content/coverage/<area>.json` lists the named
 *   sites shops in that area actually run, from the sources it names, and
 *   `pnpm content:coverage` reports how many the catalog defines. The 80%
 *   promise is per area, so an area is the grain of the promise.
 *
 * An area is added by the **expand-content** skill, together with its
 * denominator, its templates and their photos — never one without the others.
 */
export type DiveAreaRegion = {
  /** ISO 3166-1 alpha-2, as `shops.address_country` stores it. */
  country: string;
  /**
   * The subdivisions an address may name for this area, upper-cased: the ISO
   * 3166-2 code without its country prefix and the name a person types
   * (`["FL", "FLORIDA"]`). Absent when the whole country is the area.
   */
  subdivisions?: readonly string[];
  /**
   * The IANA zones that stand in for an address a shop has not given yet.
   * Only a zone that is *mostly* this area belongs here: `America/New_York`
   * guesses Florida because that is where the catalog's Eastern-zone shops
   * are, and a New York shop corrects it the moment it types an address.
   */
  timeZones?: readonly string[];
};

export type DiveArea = {
  code: string;
  /** The area as a diver would name it, in English. Used by tooling and docs only. */
  label: string;
  region: DiveAreaRegion;
};

const FLORIDA: DiveAreaRegion = {
  country: "US",
  subdivisions: ["FL", "FLORIDA"],
  timeZones: ["America/New_York"],
};

export const DIVE_AREAS = [
  { code: "florida-keys-upper", label: "Upper Keys (Key Largo)", region: FLORIDA },
  { code: "florida-keys-islamorada", label: "Islamorada", region: FLORIDA },
  { code: "florida-keys-marathon", label: "Marathon", region: FLORIDA },
  { code: "florida-keys-lower", label: "Lower Keys", region: FLORIDA },
  { code: "florida-keys-key-west", label: "Key West and the Dry Tortugas", region: FLORIDA },
  { code: "florida-palm-beach", label: "Palm Beach County", region: FLORIDA },
  { code: "florida-broward", label: "Broward County (Fort Lauderdale)", region: FLORIDA },
  { code: "florida-miami", label: "Miami-Dade and Biscayne", region: FLORIDA },
  { code: "florida-panhandle", label: "Florida Panhandle", region: FLORIDA },
  { code: "florida-gulf-coast", label: "Florida Gulf coast", region: FLORIDA },
  { code: "florida-springs", label: "Florida springs", region: FLORIDA },
] as const satisfies readonly DiveArea[];

export type DiveAreaCode = (typeof DIVE_AREAS)[number]["code"];

export const DIVE_AREA_BY_CODE: ReadonlyMap<string, DiveArea> = new Map(
  DIVE_AREAS.map((area) => [area.code, area]),
);
