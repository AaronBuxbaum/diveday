import { and, eq, inArray, isNull } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { type CalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { people, personRoles, staffCredentials } from "./schema";

/** Fictional, current evidence for the demo cast; real shops supply their own records. */
export async function seedSafeCrew(db: DbExecutor, shopId: string) {
  const staff = await db
    .select({ personId: people.id, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    );
  const now = nowDate();
  const day = now.toISOString().slice(0, 10) as CalendarDate;
  const issuedAt = shiftCalendarDate(day, -365);
  const renewsAt = shiftCalendarDate(day, 730);
  const reviewer = staff.find((row) => row.role === "owner")?.personId ?? staff[0]?.personId;
  if (!reviewer) return;
  const kindsByPerson = new Map<string, Set<typeof staffCredentials.$inferInsert.kind>>();
  for (const row of staff) {
    const kinds =
      kindsByPerson.get(row.personId) ??
      new Set(["first_aid_cpr", "oxygen_provider", "liability_insurance"] as const);
    if (row.role === "captain") kinds.add("captains_licence");
    if (row.role === "instructor") kinds.add("instructor_rating");
    if (row.role === "assistant_instructor") kinds.add("assistant_instructor_rating");
    if (row.role === "divemaster") kinds.add("divemaster_rating");
    kindsByPerson.set(row.personId, kinds);
  }
  const names = {
    first_aid_cpr: "Emergency First Response Primary and Secondary Care",
    oxygen_provider: "DAN Emergency Oxygen for Scuba Diving Injuries",
    liability_insurance: "Professional diving liability insurance",
    captains_licence: "USCG Master 50 GRT Near Coastal",
    instructor_rating: "PADI Open Water Scuba Instructor",
    divemaster_rating: "PADI Divemaster",
    assistant_instructor_rating: "PADI Assistant Instructor",
    other: "Crew credential",
  };
  for (const [personId, kinds] of kindsByPerson) {
    await db
      .insert(staffCredentials)
      .values(
        [...kinds].map((kind) => ({
          shopId,
          personId,
          kind,
          name: names[kind],
          identifier: `DEMO-${personId}-${kind}`,
          issuedAt,
          renewsAt,
          status: "verified" as const,
          reviewedAt: now,
          reviewedByPersonId: reviewer,
          reviewNote: "Fictional demo credential; no real credential or policy is represented.",
        })),
      )
      .onConflictDoNothing();
  }
}
