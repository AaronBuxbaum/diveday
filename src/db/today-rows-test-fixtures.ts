import { staffTranslator } from "@/i18n/staff-messages";
import type { TodayRowsContext } from "./today-rows-context";

/** The frozen test clock's moment: a Tuesday morning in Key Largo. */
export const NOW = new Date("2026-07-21T13:30:00Z");

/**
 * A row builder's context with an empty window and an empty wave, so a test
 * names only the answers its builder reads. The wave is cast: each builder
 * reads its own handful of fields, and a test spells exactly those.
 */
export function rowsContext(
  wave: Record<string, unknown> = {},
  overrides: Partial<TodayRowsContext> = {},
): TodayRowsContext {
  return {
    wave: wave as unknown as TodayRowsContext["wave"],
    inWindow: [],
    upcoming: [],
    readinessByTrip: new Map(),
    todayTrips: [],
    today: "2026-07-21",
    todayLocal: "2026-07-21",
    todayTripIds: [],
    bookingIdsByTrip: new Map(),
    horizon: new Date(NOW.getTime() + 7 * 24 * 3_600_000),
    shopSlug: "blue-mantis",
    timeZone: "America/New_York",
    locale: "en-US",
    t: staffTranslator("en-US"),
    now: NOW,
    diversPerDivemaster: 6,
    roles: undefined,
    personId: undefined,
    helpRequestsByTrip: new Map(),
    availableStaff: [],
    includeOpsAlerts: false,
    ...overrides,
  };
}
