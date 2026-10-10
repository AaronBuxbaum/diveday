import type { TripPrep } from "@/db/trips";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **What every section of the packing list reads**, handed down as one typed
 * object rather than seven props apiece: the departure's prep, the words, and
 * where its links and ids point.
 */
export type PrepView = {
  prep: TripPrep;
  t: StaffTranslator;
  locale: string;
  shopSlug: string;
  tripId: string;
  idPrefix: string | undefined;
  /** A blown-out departure packs nothing; see `PrepBody`'s `cancelled`. */
  cancelled: boolean;
};

/** One piece a renting diver still wants a unit for. */
export type WantedItem = TripPrep["assignmentRows"][number]["wanted"][number];
