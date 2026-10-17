import { and, eq } from "drizzle-orm";
import type { IncidentDraftFields } from "@/lib/incident-reports";
import type { AppDb } from "./client";
import { incidentReports, tripAssignments } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/** Shared by the incident report db tests: a departure, its people, and two drafts' worth of answers. */

export const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";

export const OTHER_TRIP = "99999999-8888-4777-8666-444444444444";
export const OCCURRED_AT = new Date("2026-10-01T15:20:00Z");

export const complete: IncidentDraftFields = {
  occurredAt: OCCURRED_AT,
  diveSiteId: null,
  locationText: "North wall mooring",
  whatHappened: "Diver surfaced coughing after a fast ascent from 18 m.",
  kind: "injury",
  severity: "moderate",
  firstAidGiven: true,
  oxygenGiven: true,
  oxygenMinutes: 25,
  emergencyServicesCalled: false,
  handoverKind: "diver",
  handoverDetail: null,
  handedOverAt: new Date("2026-10-01T16:30:00Z"),
  followUp: null,
};

/** A draft's fields with nothing answered. */
export const blank: IncidentDraftFields = {
  occurredAt: null,
  diveSiteId: null,
  locationText: null,
  whatHappened: null,
  kind: null,
  severity: null,
  firstAidGiven: null,
  oxygenGiven: null,
  oxygenMinutes: null,
  emergencyServicesCalled: null,
  handoverKind: null,
  handoverDetail: null,
  handedOverAt: null,
  followUp: null,
};

/**
 * A booked departure, a crew member on it (the divemaster), staff who are not
 * (the captain), and the owner. Crew is set here rather than read from the
 * seed, so the test says who is aboard.
 */
export async function fixture(db: AppDb, shopId: string) {
  const trip = (await upcomingTripsWithCounts(db, shopId)).find((row) => row.booked > 0);
  if (!trip) throw new Error("expected a booked trip");
  const [seat] = await getTripRoster(db, shopId, trip.id);
  const staff = await listStaff(db, shopId);
  const byRole = (role: string) => staff.find((member) => member.roles.includes(role))?.person;
  const owner = byRole("owner");
  const crew = byRole("divemaster");
  const ashore = byRole("captain");
  if (!seat || !owner || !crew || !ashore) throw new Error("expected seeded people");
  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.id });
  return { trip, seat, owner, crew, ashore };
}

/** How many unfiled drafts one writer holds on one departure. */
export async function draftsBy(db: AppDb, tripId: string, personId: string): Promise<number> {
  const rows = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.tripId, tripId),
        eq(incidentReports.createdByPersonId, personId),
        eq(incidentReports.status, "draft"),
      ),
    );
  return rows.length;
}
