import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import type { HorizonReadinessEvidence } from "./blockers";
import type { TodayWave } from "./today";

/**
 * Everything the Today queue's row builders read, gathered once by
 * `getTodayWork` after its one wave: the window, the shop's clock and words,
 * and the wave's answers. The builders push rows in the order the queue has
 * always pushed them, and none of them reads the database.
 */
export type TodayRowsContext = {
  wave: TodayWave;
  inWindow: HorizonReadinessEvidence["trips"];
  upcoming: HorizonReadinessEvidence["upcoming"];
  readinessByTrip: HorizonReadinessEvidence["readinessByTrip"];
  todayTrips: HorizonReadinessEvidence["trips"];
  /** The shop's own calendar day, as `shopDay` spells it. */
  today: string;
  todayLocal: string;
  todayTripIds: string[];
  bookingIdsByTrip: Map<string, string[]>;
  horizon: Date;
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: StaffTranslator;
  now: Date;
  diversPerDivemaster: number | null;
  roles: readonly Role[] | undefined;
  personId: string | undefined;
  helpRequestsByTrip: Map<string, TodayWave["helpRequests"]>;
  availableStaff: { id: string; fullName: string; roles: TodayWave["rawStaff"][number]["roles"] }[];
  includeOpsAlerts: boolean;
};
