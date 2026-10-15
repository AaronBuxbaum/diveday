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

const country = (code: string, ...timeZones: string[]): DiveAreaRegion => ({
  country: code,
  ...(timeZones.length ? { timeZones } : {}),
});
const CAYMAN = country("KY", "America/Cayman");
const QUINTANA_ROO: DiveAreaRegion = {
  country: "MX",
  subdivisions: ["ROO", "QUINTANA ROO"],
  timeZones: ["America/Cancun"],
};
const BELIZE = country("BZ", "America/Belize");
const BAY_ISLANDS: DiveAreaRegion = {
  country: "HN",
  subdivisions: ["IB", "ISLAS DE LA BAHIA", "ISLAS DE LA BAHÍA", "BAY ISLANDS"],
};
const BAHAMAS = country("BS", "America/Nassau");
const TURKS_AND_CAICOS = country("TC", "America/Grand_Turk");
const USVI = country("VI", "America/St_Thomas");

export const DIVE_AREAS = [
  { code: "florida-keys-upper", label: "Upper Keys (Key Largo)", region: FLORIDA },
  { code: "florida-keys-islamorada", label: "Islamorada", region: FLORIDA },
  { code: "florida-keys-marathon", label: "Marathon", region: FLORIDA },
  { code: "florida-keys-lower", label: "Lower Keys", region: FLORIDA },
  { code: "florida-keys-key-west", label: "Key West and the Dry Tortugas", region: FLORIDA },
  {
    code: "florida-palm-beach",
    label: "Palm Beach County and the Treasure Coast",
    region: FLORIDA,
  },
  { code: "florida-broward", label: "Broward County (Fort Lauderdale)", region: FLORIDA },
  { code: "florida-miami", label: "Miami-Dade and Biscayne", region: FLORIDA },
  { code: "florida-panhandle", label: "Florida Panhandle", region: FLORIDA },
  { code: "florida-gulf-coast", label: "Florida Gulf coast", region: FLORIDA },
  { code: "florida-springs", label: "Florida springs", region: FLORIDA },
  {
    code: "bonaire",
    label: "Bonaire and Klein Bonaire",
    region: { country: "BQ", subdivisions: ["BO", "BONAIRE"], timeZones: ["America/Kralendijk"] },
  },
  { code: "curacao", label: "Curaçao", region: country("CW", "America/Curacao") },
  { code: "aruba", label: "Aruba", region: country("AW", "America/Aruba") },
  { code: "cayman-grand-cayman", label: "Grand Cayman", region: CAYMAN },
  { code: "cayman-sister-islands", label: "Cayman Brac and Little Cayman", region: CAYMAN },
  { code: "mexico-cozumel", label: "Cozumel", region: QUINTANA_ROO },
  {
    code: "mexico-riviera-maya",
    label: "Cancún, Isla Mujeres and the Riviera Maya",
    region: QUINTANA_ROO,
  },
  {
    code: "mexico-cenotes",
    label: "Yucatán cenotes",
    region: {
      country: "MX",
      subdivisions: ["ROO", "QUINTANA ROO", "YUC", "YUCATAN", "YUCATÁN"],
      timeZones: ["America/Cancun", "America/Merida"],
    },
  },
  {
    code: "mexico-costa-maya",
    label: "Costa Maya and Banco Chinchorro",
    region: QUINTANA_ROO,
  },
  { code: "belize-north", label: "Ambergris Caye and Caye Caulker", region: BELIZE },
  { code: "belize-atolls", label: "Belize atolls", region: BELIZE },
  { code: "belize-south", label: "Southern Belize", region: BELIZE },
  { code: "honduras-roatan", label: "Roatán and Cayos Cochinos", region: BAY_ISLANDS },
  { code: "honduras-utila", label: "Utila", region: BAY_ISLANDS },
  { code: "honduras-guanaja", label: "Guanaja", region: BAY_ISLANDS },
  {
    code: "colombia-san-andres",
    label: "San Andrés and Providencia",
    region: {
      country: "CO",
      subdivisions: [
        "SAP",
        "SAN ANDRES",
        "SAN ANDRÉS",
        "SAN ANDRES Y PROVIDENCIA",
        "SAN ANDRÉS Y PROVIDENCIA",
        "SAN ANDRES, PROVIDENCIA Y SANTA CATALINA",
        "SAN ANDRÉS, PROVIDENCIA Y SANTA CATALINA",
      ],
    },
  },
  { code: "bahamas-new-providence", label: "Nassau and New Providence", region: BAHAMAS },
  { code: "bahamas-grand-bahama", label: "Grand Bahama", region: BAHAMAS },
  { code: "bahamas-abaco", label: "The Abacos", region: BAHAMAS },
  { code: "bahamas-eleuthera", label: "Eleuthera and Harbour Island", region: BAHAMAS },
  { code: "bahamas-exuma", label: "The Exumas", region: BAHAMAS },
  { code: "bahamas-andros", label: "Andros", region: BAHAMAS },
  { code: "bahamas-bimini", label: "Bimini", region: BAHAMAS },
  {
    code: "bahamas-out-islands",
    label: "Long Island, San Salvador, Cat Island and the southern Bahamas",
    region: BAHAMAS,
  },
  {
    code: "turks-caicos-providenciales",
    label: "Providenciales, West Caicos and French Cay",
    region: TURKS_AND_CAICOS,
  },
  {
    code: "turks-caicos-grand-turk",
    label: "Grand Turk, Salt Cay and South Caicos",
    region: TURKS_AND_CAICOS,
  },
  { code: "puerto-rico", label: "Puerto Rico", region: country("PR", "America/Puerto_Rico") },
  { code: "usvi-st-thomas-st-john", label: "St Thomas and St John", region: USVI },
  { code: "usvi-st-croix", label: "St Croix", region: USVI },
  { code: "bvi", label: "British Virgin Islands", region: country("VG", "America/Tortola") },
  {
    code: "dominican-republic",
    label: "Dominican Republic",
    region: country("DO", "America/Santo_Domingo"),
  },
  { code: "jamaica", label: "Jamaica", region: country("JM", "America/Jamaica") },
  { code: "cuba", label: "Cuba", region: country("CU", "America/Havana") },
  { code: "anguilla", label: "Anguilla", region: country("AI", "America/Anguilla") },
  { code: "sint-maarten", label: "Sint Maarten", region: country("SX", "America/Lower_Princes") },
  { code: "saint-martin", label: "Saint-Martin", region: country("MF", "America/Marigot") },
  {
    code: "saint-barthelemy",
    label: "Saint-Barthélemy",
    region: country("BL", "America/St_Barthelemy"),
  },
  { code: "saba", label: "Saba", region: { country: "BQ", subdivisions: ["SA", "SABA"] } },
  {
    code: "sint-eustatius",
    label: "Sint Eustatius (Statia)",
    region: { country: "BQ", subdivisions: ["SE", "SINT EUSTATIUS", "STATIA"] },
  },
  {
    code: "st-kitts-nevis",
    label: "St Kitts and Nevis",
    region: country("KN", "America/St_Kitts"),
  },
  {
    code: "antigua-barbuda",
    label: "Antigua and Barbuda",
    region: country("AG", "America/Antigua"),
  },
  { code: "montserrat", label: "Montserrat", region: country("MS", "America/Montserrat") },
  { code: "guadeloupe", label: "Guadeloupe", region: country("GP", "America/Guadeloupe") },
  { code: "dominica", label: "Dominica", region: country("DM", "America/Dominica") },
  { code: "martinique", label: "Martinique", region: country("MQ", "America/Martinique") },
  { code: "saint-lucia", label: "Saint Lucia", region: country("LC", "America/St_Lucia") },
  {
    code: "st-vincent-grenadines",
    label: "St Vincent and the Grenadines",
    region: country("VC", "America/St_Vincent"),
  },
  { code: "grenada", label: "Grenada and Carriacou", region: country("GD", "America/Grenada") },
  { code: "barbados", label: "Barbados", region: country("BB", "America/Barbados") },
  {
    code: "trinidad-tobago",
    label: "Tobago and Trinidad",
    region: country("TT", "America/Port_of_Spain"),
  },
] as const satisfies readonly DiveArea[];

export type DiveAreaCode = (typeof DIVE_AREAS)[number]["code"];

export const DIVE_AREA_BY_CODE: ReadonlyMap<string, DiveArea> = new Map(
  DIVE_AREAS.map((area) => [area.code, area]),
);
