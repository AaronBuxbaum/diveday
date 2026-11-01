import { canPersonConfigureTrips } from "@/db/authz";
import { requireShopSurface } from "@/lib/session";

/**
 * Trip *definition* — what the dive is and who it admits (details, admission
 * requirements, and the whole-series operations) — is owner/manager/instructor
 * work (H-20260724-staff-role-reach, ADR 20260724-role-authorization). Re-checks live roles against the
 * DB and bounces a disallowed staff member to the trip Overview with a
 * not-authorized notice.
 *
 * This is deliberately narrower than "everything on Overview": the *operating*
 * actions the glossary assigns to the day-of crew — predicted-conditions entry,
 * day-of crew assignment (manifest accuracy), and a single trip's weather
 * cancellation — stay on the ordinary shop-surface preamble, as do the
 * roster/booking/recap actions. Only trip definition and bulk schedule
 * management add the live role gate below.
 */
export async function requireTripConfig(shopSlug: string, tripId: string) {
  const { session } = await requireShopSurface(shopSlug, {
    allow: canPersonConfigureTrips,
    refusal: { notice: "not-authorized", landing: ["trips", tripId] },
  });
  return session;
}
